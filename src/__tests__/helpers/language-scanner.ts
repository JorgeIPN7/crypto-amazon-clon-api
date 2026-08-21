// src/__tests__/helpers/language-scanner.ts
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import ts from 'typescript';

export type LanguageViolation = {
  file: string;
  line: number;
  name: string;
  /** `non-ascii` para un identificador fuera de ASCII; si no, la raíz española que lo delata. */
  reason: string;
};

/**
 * Raíces españolas prohibidas en un identificador.
 *
 * LISTA CERRADA, y se compara por SEGMENTO EXACTO, nunca por subcadena. La diferencia no es
 * cosmética: con `includes()` esta lista se vuelve inservible el primer día —`imported`
 * contiene «importe», `role` contiene «rol», `limiter` contiene «limite» y
 * `InvalidOrderAmountError` contiene «valido»—. Al segmentar primero y comparar cada segmento
 * completo, los cuatro pasan y `nombreMinimo` sigue cayendo.
 *
 * Falla en cerrado por el mismo criterio que la lista del selector de `eslint.config.mjs`:
 * una raíz nueva cuesta una línea revisada, y a cambio ninguna palabra inglesa legítima se
 * marca sola. Por eso NO entran las palabras que se escriben igual en los dos idiomas
 * (`total`, `error`, `final`, `local`, `normal`, `original`, `general`): añadirlas pondría
 * roja media base de código.
 */
export const SPANISH_ROOTS: ReadonlySet<string> = new Set(
  `
    activo actualizar ajustes alcance alta alternativas apellido archivo aviso baja borrar
    buscar campo cantidad carpeta cierre clave claves cliente clientes completo concepto
    configuracion consulta contrasena contrato correo crear credencial credenciales cuenta
    cuentas datos descripcion direccion ejemplo ejemplos eliminar entorno entrada enviar estado
    estandar fabrica fallo fallos fecha guardar importe inactivo intento intentos invalido
    limite linea listar llave maximo mensaje migracion minimo mutacion nombre nombres numero
    obtener orden ordenes origen pagina pais pedido pedidos perfil precio previo problema
    propuesta prueba pruebas registro reproduccion respuesta resultado saldo salida semilla
    sesion sobre solicitud tamano telefono titulo tomado usuario usuarios valido valor valores
  `
    .trim()
    .split(/[^a-z0-9]+/),
);

/**
 * Parte un identificador en sus palabras.
 *
 * La alternancia importa: `[A-Z]+(?![a-z])` se queda con los acrónimos enteros y la segunda
 * rama con lo demás. Un `(?=[A-Z])` a secas —lo obvio— destroza el SCREAMING_CASE:
 * `USER_ROLES` saldría como `u`, `s`, `e`, `r`, `r`, `o`, `l`, `e`, `s`. Así salen
 * `[user, roles]`, y `HTTPServer` sale `[http, server]`.
 *
 * `_`, `-` y `$` no casan con ninguna rama, así que hacen de separador sin tratarlos aparte.
 */
export const segmentsOf = (name: string): string[] =>
  (name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z0-9]+/g) ?? []).map((segment) => segment.toLowerCase());

/**
 * Busca violaciones entre los nombres DECLARADOS de un fuente TypeScript.
 *
 * Solo mira `node.name` cuando es un `Identifier`, y eso es justo lo que hace al gate
 * compatible con la convención: recoge declaraciones y claves de objeto sin comillas —que es
 * lo que era `válido:` en `auth.controller.ts`— y no ve ni un solo literal de cadena. Los `it`
 * en español, los `describe` anidados y los datos de fixture quedan fuera por construcción,
 * sin necesitar una sola excepción.
 *
 * LÍMITE CONOCIDO, escrito para que nadie le atribuya más de lo que hace: una clave ENTRE
 * COMILLAS (`{ 'nombre completo': 1 }`) es un `StringLiteral`, no un `Identifier`, y este
 * escáner no la ve. Cubrirla exigiría distinguir una clave de contrato (`'x-api-key'`) de una
 * clave en español, y ese criterio no existe en el nodo.
 */
export const scanSource = (source: string, file = 'fixture.ts'): LanguageViolation[] => {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const violations: LanguageViolation[] = [];

  const visit = (node: ts.Node): void => {
    const name: ts.Node | undefined = (node as ts.NamedDeclaration).name;
    if (name !== undefined && ts.isIdentifier(name)) {
      const line = sourceFile.getLineAndCharacterOfPosition(name.getStart(sourceFile)).line + 1;
      if (!/^[\x20-\x7E]*$/.test(name.text)) {
        violations.push({ file, line, name: name.text, reason: 'non-ascii' });
      }
      const root = segmentsOf(name.text).find((segment) => SPANISH_ROOTS.has(segment));
      if (root !== undefined) {
        violations.push({ file, line, name: name.text, reason: root });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return violations;
};

/** Todos los `.ts` bajo `dir`, recursivo. `node_modules` nunca entra. */
export const collectTsFiles = (dir: string, found: string[] = []): string[] => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') {
        collectTsFiles(full, found);
      }
    } else if (entry.name.endsWith('.ts')) {
      found.push(full);
    }
  }
  return found;
};

/** Aplica `scanSource` a cada archivo de `dirs`, con la ruta relativa a `root` en el reporte. */
export const scanTree = (root: string, dirs: readonly string[]): LanguageViolation[] =>
  dirs
    .flatMap((dir) => collectTsFiles(path.join(root, dir)))
    .flatMap((file) =>
      scanSource(readFileSync(file, 'utf-8'), path.relative(root, file).split(path.sep).join('/')),
    );
