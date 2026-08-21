import { Injectable } from '@nestjs/common';

import { Credential } from '../../domain/entities/credential.entity';
import { EmailAlreadyRegisteredError, InvalidProfileError } from '../../domain/errors/auth.errors';
import { CredentialRepository } from '../../domain/ports/credential.repository';
import { PasswordHasher } from '../../domain/ports/password-hasher';
import { UserDirectory, type DirectoryUser } from '../../domain/ports/user-directory';

export type RegisterAccountInput = {
  email: string;
  name: string;
  password: string;
};

/**
 * Alta de cuenta: perfil en `users` + credencial en `auth`, dos dueños y dos escrituras.
 *
 * **Sin transacción distribuida y sin fingirla.** Las dos escrituras viven en contextos
 * distintos —hoy en la misma base, mañana quizá no— así que la consistencia se consigue con
 * una COMPENSACIÓN explícita: si la credencial no puede escribirse, se deshacen las dos
 * filas y el error original se propaga. Lo que se garantiza es que no queda un perfil
 * huérfano —uno sin credencial es un usuario que jamás podría entrar y que además bloquea su
 * propio email por el índice único—, no que las dos escrituras sean atómicas.
 *
 * **El hash se calcula ANTES de saber si el email está libre, y eso no es el orden natural.**
 * Es la corrección del backlog #15: con el orden anterior —perfil primero, hash después— el
 * camino «email tomado» no pagaba el argon2id, así que el 409 era redundante: el reloj ya
 * decía si la cuenta existía, y lo decía aunque el cliente ignorase el código de estado.
 *
 * Medido en esta máquina (2026-08-08) sobre HTTP contra PostgreSQL real, 20 muestras por
 * camino INTERCALADAS para cancelar la deriva, con los `ARGON2_PARAMS` del repo — medianas y
 * rangos en ms:
 *
 * | Orden             | 409 email tomado      | 201 email libre        | Ratio  |
 * | ----------------- | --------------------- | ---------------------- | ------ |
 * | Antes (`5def8ed`) | 7.52 (6.35 – 10.93)   | 91.47 (85.82 – 101.04) | 12.2 × |
 * | Después           | 79.61 (71.74 – 85.52) | 90.82 (82.23 – 128.48) | 1.14 × |
 *
 * Lo decisivo no es el ratio sino el SOLAPE: antes el 409 más lento (10.93) seguía siendo
 * ocho veces más rápido que el 201 más rápido (85.82), así que una sola petición bastaba
 * para clasificar el email; ahora los dos rangos se pisan y una muestra suelta no dice nada.
 * Ambas filas se reprodujeron en una segunda corrida (7.76/92.61 y 79.43/90.78).
 *
 * **Lo que queda sin cerrar, dicho sin adornos:** ~11 ms de diferencia en la mediana. No es
 * el hash —los dos caminos lo pagan entero— sino los viajes a la base que solo hace el alta
 * correcta (INSERT del perfil e INSERT de la credencial frente al SELECT del pre-check).
 * Cerrarlo del todo exigiría igualar también la escritura, que es un coste sin contrapartida:
 * con el solape actual, distinguir los caminos exige un ataque estadístico con muchas
 * muestras por email, y para eso está el `@Throttle` de 10/min por handler del controller.
 *
 * El precio del cambio es un hash que se tira cuando el alta se rechaza: el mismo `@Throttle`
 * acota lo que un atacante puede hacer con esa CPU.
 *
 * El resto del orden sigue mandado por los datos: el perfil antes que la credencial, porque
 * es quien decide si el email está libre y quien acuña el id que la credencial necesita.
 */
@Injectable()
export class RegisterAccountUseCase {
  constructor(
    private readonly users: UserDirectory,
    private readonly credentials: CredentialRepository,
    private readonly hasher: PasswordHasher,
  ) {}

  async execute(input: RegisterAccountInput): Promise<DirectoryUser> {
    // Antes del pre-check de unicidad a propósito: es lo que iguala el coste de los dos
    // caminos (ver cabecera). Si el alta se rechaza, este hash se descarta.
    const passwordHash = await this.hasher.hash(input.password);

    const created = await this.users.createProfile({ email: input.email, name: input.name });

    if (!created.ok) {
      // El puerto devuelve un resultado, no lanza: los errores de `users` son suyos y auth
      // no puede importarlos. Aquí se traducen a errores de ESTE dominio, que su propio
      // filtro convierte en 409 y 400 — exactamente los que publicaba `POST /users`.
      if (created.reason === 'email-taken') {
        throw new EmailAlreadyRegisteredError(input.email);
      }
      throw new InvalidProfileError(created.message);
    }

    try {
      await this.credentials.save(
        Credential.create({ userId: created.user.id, passwordHash, now: new Date() }),
      );
    } catch (error) {
      // Compensación. El `await` es deliberado: propagar antes de terminar el borrado
      // dejaría la carrera abierta. Si el propio borrado fallara, su error sustituye al
      // original — ruidoso a propósito: hay un perfil huérfano que alguien debe mirar
      // (backlog #16 tiene el arreglo decidido; hoy hay DOS borrados que podrían enmascarar
      // el error original en vez de uno).
      //
      // **Se borran las DOS filas y en este orden** (backlog #14). Que la credencial pueda
      // existir aquí no es teórico: si el INSERT se confirma en el motor pero la respuesta se
      // pierde —timeout, pod muerto— el `save` rechaza con la fila ya escrita. Antes del
      // ciclo 4 el hash era una columna de `users` y se iba con el perfil por construcción;
      // desde que `auth_credentials` es una tabla aparte, sin FK y sin ON DELETE CASCADE (el
      // esquema no tiene una sola FOREIGN KEY, y no se reintroduce: los dos contextos podrían
      // dejar de compartir base), esa fila se quedaba para siempre.
      //
      // El perfil PRIMERO porque es la garantía prioritaria y no puede quedar supeditada a la
      // otra: uno huérfano bloquea su propio email por el índice único y su dueño no podría
      // registrarse nunca más. Al revés, un fallo borrando la credencial abortaría el borrado
      // del perfil y dejaría precisamente ese estado. Con este orden, lo peor que puede pasar
      // si falla el segundo borrado es una fila con un hash y sin dueño: basura silenciosa que
      // no colisiona con nada.
      await this.users.deleteProfile(created.user.id);
      await this.credentials.deleteByUserId(created.user.id);
      throw error;
    }

    return created.user;
  }
}
