#!/usr/bin/env node
/**
 * Generador de bounded contexts: `pnpm module:new <contexto> [entidad]`.
 *
 * Produce el esqueleto COMPLETO de un módulo con la forma que `CLAUDE.md` exige —capas,
 * puertos como `abstract class`, dos modelos, filtro de dominio, documentación OpenAPI y los
 * specs 1:1— y con los tests en verde desde el primer momento.
 *
 * **Por qué genera también los tests.** El repo exige un spec por archivo fuente y mide
 * mutación con umbral de rotura. Un generador que soltara solo el código de producción haría
 * nacer cada módulo incumpliendo dos gates a la vez, y lo primero que haría su autor sería
 * pelearse con la CI en vez de escribir su dominio. Los specs que salen de aquí son reales: se
 * ejecutan, pasan, y sirven de plantilla para los casos de verdad.
 *
 * **Por qué por argumento y no interactivo.** El generador de `bridge-fital-pti-api` pregunta
 * por `readline`, lo que impide usarlo desde un script o desde un agente. Con argumento es
 * scriptable y no cambia nada más.
 *
 * **Verificado generando un módulo de verdad**, no razonando sobre las plantillas. Se corrió
 * `pnpm module:new invoices`, se registró en `app.module.ts`, se generó y aplicó su migración, y
 * se pasó el DoD entero. Resultado medido:
 *
 *   typecheck VERDE · lint:check VERDE (gate de fronteras incluido) · format:check VERDE
 *   716 unitarios verdes · mutación GLOBAL 93.83 % con el módulo dentro (umbral de rotura 85)
 *
 * Los dos únicos fallos fueron los que TIENEN que fallar, y los dos enseñaron algo:
 *   • `openapi-runtime-contract` se puso rojo porque `POST /invoices` no tenía escenario en su
 *     guion. Es el guard haciendo su trabajo.
 *   • `migrations.e2e-spec` se puso rojo porque su lista de tablas estaba escrita a mano
 *     («esperaba 4, hay 5»). Se corrigió DERIVÁNDOLA de las ORM entities registradas, con lo que
 *     además pasó a detectar el defecto contrario: una entidad cuya tabla ninguna migración crea.
 *
 * El módulo de prueba se borró después: no se deja en el árbol un contexto que nadie pidió.
 *
 * ⚠️ **Lo que NO hace, y hay que hacer a mano** (lo imprime al terminar):
 *   1. La migración. Necesita un timestamp y el DDL real de la tabla, y `migration:generate` ya
 *      la deriva de la ORM entity — generarla aquí sería adivinarla.
 *   2. El scope de commitlint. `commitlint.config.cjs` tiene la lista CERRADA a propósito.
 *   3. Registrar el módulo en `app.module.ts`.
 * Son tres cosas que un generador puede equivocarse al tocar y que cuestan una línea a mano.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const [, , rawContext, rawEntity] = process.argv;

if (!rawContext || !/^[a-z][a-z0-9-]*$/.test(rawContext)) {
  console.error('Uso: pnpm module:new <contexto> [entidad]');
  console.error('  contexto  kebab-case, normalmente plural: `invoices`, `payment-methods`');
  console.error('  entidad   kebab-case singular. Por defecto se deriva quitando la `s` final.');
  console.error('');
  console.error('Ejemplos:');
  console.error('  pnpm module:new invoices           -> contexto invoices, entidad invoice');
  console.error('  pnpm module:new auth credential    -> contexto auth,     entidad credential');
  process.exit(1);
}

const context = rawContext;
// Derivación deliberadamente tonta: quitar la `s` final acierta en `invoices`/`invoice` y falla
// en cualquier plural irregular. Por eso el segundo argumento existe — adivinar mejor pediría una
// librería de pluralización para un caso que se resuelve escribiendo la palabra.
const entity = rawEntity ?? (context.endsWith('s') ? context.slice(0, -1) : context);

const pascal = (value) => value.split('-').map((p) => p[0].toUpperCase() + p.slice(1)).join('');
const camel = (value) => { const p = pascal(value); return p[0].toLowerCase() + p.slice(1); };
const snake = (value) => value.replace(/-/g, '_');

const C = {
  context,                       // invoices
  Context: pascal(context),      // Invoices
  entity,                        // invoice
  Entity: pascal(entity),        // Invoice
  entityCamel: camel(entity),    // invoice
  table: snake(context),         // invoices
};

const ROOT = join(process.cwd(), 'src', 'modules', C.context);

if (existsSync(ROOT)) {
  console.error(`✖ Ya existe src/modules/${C.context}. No se sobrescribe nada.`);
  process.exit(1);
}

/** Sustituye los marcadores. Se hace por reemplazo y no por template literal para que las
 *  plantillas de abajo se lean como el TypeScript que van a producir, backticks incluidos. */
const render = (template) =>
  template
    .replaceAll('%Entity%', C.Entity)
    .replaceAll('%entityCamel%', C.entityCamel)
    .replaceAll('%entity%', C.entity)
    .replaceAll('%Context%', C.Context)
    .replaceAll('%context%', C.context)
    .replaceAll('%table%', C.table);

const emit = (relativePath, template) => {
  const full = join(ROOT, render(relativePath));
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, render(template), 'utf8');
  created.push(`src/modules/${C.context}/${render(relativePath)}`);
};

const created = [];

// ─────────────────────────────────────────────────────────────────────── domain

emit('domain/errors/%context%.errors.ts', `import { DomainError } from '@shared/domain/domain-error.base';

/**
 * Errores de dominio de %context%: son de negocio, NUNCA de transporte. No heredan de
 * \`HttpException\` ni conocen códigos HTTP — traducirlos es tarea de
 * \`infrastructure/http/%context%-domain-exception.filter.ts\`.
 *
 * El marcador abstracto es lo que \`@Catch(%Context%DomainError)\` discrimina: sin él, el filtro
 * de este contexto capturaría también los errores de los demás.
 */
export abstract class %Context%DomainError extends DomainError {}

export class Invalid%Entity%IdError extends %Context%DomainError {
  constructor(readonly value: string) {
    super(\`"\${value}" is not a valid %entity% id\`);
  }
}

export class Invalid%Entity%NameError extends %Context%DomainError {
  constructor(readonly value: string) {
    super(\`"\${value}" is not a valid %entity% name\`);
  }
}

export class %Entity%NotFoundError extends %Context%DomainError {
  constructor(readonly %entityCamel%Id: string) {
    super(\`%Entity% \${%entityCamel%Id} was not found\`);
  }
}
`);

emit('domain/value-objects/%entity%-id.vo.ts', `import { UuidId } from '@shared/domain/uuid-id.base';

import { Invalid%Entity%IdError } from '../errors/%context%.errors';

/**
 * Identidad del agregado. Es un value object para que un \`string\` cualquiera no pueda pasar por
 * un id de %entity%: el tipo obliga a construirlo por \`from()\` o \`generate()\`.
 *
 * El formato lo valida \`UuidId\`; el ERROR lo pone este archivo, porque el kernel no puede
 * importar los errores de un módulo.
 */
export class %Entity%Id extends UuidId {
  static generate(): %Entity%Id {
    return new %Entity%Id(UuidId.newUuid());
  }

  static from(value: string): %Entity%Id {
    return new %Entity%Id(UuidId.assertUuid(value, (invalid) => new Invalid%Entity%IdError(invalid)));
  }
}
`);

emit('domain/entities/%entity%.entity.ts', `import { Entity, type AuditTrail } from '@shared/domain/entity.base';

import { Invalid%Entity%NameError } from '../errors/%context%.errors';
import type { %Entity%Id } from '../value-objects/%entity%-id.vo';

const NAME_MIN_LENGTH = 2;
const NAME_MAX_LENGTH = 120;

export type %Entity%Snapshot = {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
};

/**
 * Raíz del agregado. Sin decoradores, sin ORM y sin framework: sus invariantes se garantizan en
 * el constructor y en los métodos, no en un validador externo.
 *
 * \`id\` y la traza de auditoría los pone \`Entity\`, junto con \`equals()\` y \`touch()\`.
 *
 * ⚠️ ESQUELETO: \`name\` es un campo de ejemplo para que el agregado tenga algo que proteger y
 * algo que mutar. Sustitúyelo por el estado real de tu dominio — pero conserva la forma:
 * constructor privado, \`create()\` con \`now\` y \`createdBy\` inyectados, \`rehydrate()\` sin reglas
 * de creación, y todo mutador llamando a \`touch(now, by)\`.
 */
export class %Entity% extends Entity<%Entity%Id> {
  private constructor(
    id: %Entity%Id,
    private _name: string,
    audit: AuditTrail,
  ) {
    super(id, audit);
  }

  static create(params: {
    id: %Entity%Id;
    name: string;
    now: Date;
    createdBy: string | null;
  }): %Entity% {
    const name = %Entity%.assertName(params.name);
    return new %Entity%(params.id, name, {
      createdAt: params.now,
      updatedAt: params.now,
      createdBy: params.createdBy,
      updatedBy: params.createdBy,
    });
  }

  /** Reconstituye desde persistencia sin volver a aplicar las reglas de creación. */
  static rehydrate(params: {
    id: %Entity%Id;
    name: string;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string | null;
    updatedBy: string | null;
  }): %Entity% {
    return new %Entity%(params.id, params.name, {
      createdAt: params.createdAt,
      updatedAt: params.updatedAt,
      createdBy: params.createdBy,
      updatedBy: params.updatedBy,
    });
  }

  get name(): string {
    return this._name;
  }

  /** Idempotente: renombrar con el mismo nombre no toca la traza ni reescribe el actor. */
  rename(name: string, now: Date, by: string | null): void {
    const next = %Entity%.assertName(name);
    if (next === this._name) {
      return;
    }
    this._name = next;
    this.touch(now, by);
  }

  toSnapshot(): %Entity%Snapshot {
    return {
      id: this.id.value,
      name: this._name,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      updatedBy: this.updatedBy,
    };
  }

  private static assertName(name: string): string {
    const trimmed = name.trim();
    if (trimmed.length < NAME_MIN_LENGTH || trimmed.length > NAME_MAX_LENGTH) {
      throw new Invalid%Entity%NameError(name);
    }
    return trimmed;
  }
}
`);

emit('domain/ports/%entity%.repository.ts', `import type { %Entity% } from '../entities/%entity%.entity';
import type { %Entity%Id } from '../value-objects/%entity%-id.vo';

/**
 * Puerto de salida (driven). Vive en el dominio porque es el dominio quien decide qué necesita de
 * la persistencia; \`infrastructure/persistence/\` provee la implementación.
 *
 * Es una \`abstract class\` y NO un \`type\` + \`Symbol\`: una clase sobrevive a la compilación, así
 * que la misma referencia sirve de tipo y de token de inyección, y ningún consumidor necesita
 * \`@Inject\`.
 *
 * ⚠️ SOLO miembros \`abstract\` públicos: sin campos, sin \`protected\`/\`private\`, sin constructor.
 * Un campo rompe los fakes por objeto literal (\`TS2741\`); un constructor vacío es código muerto,
 * porque los adaptadores hacen \`implements\` y nunca \`extends\`. El razonamiento medido está en
 * \`src/modules/users/domain/ports/user.repository.ts\`.
 */
export abstract class %Entity%Repository {
  abstract findById(id: %Entity%Id): Promise<%Entity% | null>;
  abstract save(%entityCamel%: %Entity%): Promise<void>;
}
`);

// ────────────────────────────────────────────────────────────────── application

emit('application/use-cases/create-%entity%.use-case.ts', `import { Injectable } from '@nestjs/common';

import { %Entity% } from '../../domain/entities/%entity%.entity';
import { %Entity%Id } from '../../domain/value-objects/%entity%-id.vo';
import { %Entity%Repository } from '../../domain/ports/%entity%.repository';

/**
 * La entrada vive en el MISMO archivo que su caso de uso: es su firma, no una pieza reutilizable.
 * Es un \`type\` plano y NUNCA una clase con \`class-validator\` — la validación de transporte es
 * del DTO HTTP, y el gate de fronteras prohíbe esa librería en \`application/\`.
 */
export type Create%Entity%Input = {
  name: string;
  createdBy: string | null;
};

/**
 * Caso de uso: una sola operación pública (\`execute\`). Orquesta el dominio y el puerto, sin
 * conocer HTTP ni el ORM.
 *
 * ⚠️ \`new Date()\` se llama AQUÍ y se inyecta al dominio, nunca dentro del agregado: es lo que
 * hace que los mutadores sean deterministas en los tests.
 */
@Injectable()
export class Create%Entity%UseCase {
  constructor(private readonly %entityCamel%s: %Entity%Repository) {}

  async execute(input: Create%Entity%Input): Promise<%Entity%> {
    const %entityCamel% = %Entity%.create({
      id: %Entity%Id.generate(),
      name: input.name,
      now: new Date(),
      createdBy: input.createdBy,
    });

    await this.%entityCamel%s.save(%entityCamel%);
    return %entityCamel%;
  }
}
`);

// ─────────────────────────────────────────────────────────────── infrastructure

emit('infrastructure/persistence/%entity%.orm-entity.ts', `import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Modelo de persistencia. Es deliberadamente distinto del agregado del dominio: aquí viven los
 * decoradores del ORM y la forma de la tabla, y puede evolucionar sin arrastrar al dominio.
 * \`%Entity%Mapper\` es el único puente.
 *
 * Las columnas NO llevan \`name:\`: \`SnakeNamingStrategy\` las deriva en snake_case.
 * ⚠️ \`@Entity({ name })\` sí es obligatorio — sin él la tabla nacería \`%entity%_orm_entity\`.
 *
 * Las marcas de tiempo son \`@Column\` y nunca \`@CreateDateColumn\`/\`@UpdateDateColumn\`: el reloj
 * lo pone el dominio con el \`now\` que le inyecta el caso de uso.
 */
@Entity({ name: '%table%' })
export class %Entity%OrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 120 })
  name!: string;

  @Column({ type: 'timestamptz' })
  createdAt!: Date;

  @Column({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'varchar', nullable: true })
  createdBy!: string | null;

  @Column({ type: 'varchar', nullable: true })
  updatedBy!: string | null;
}
`);

emit('infrastructure/persistence/%entity%.mapper.ts', `import { %Entity% } from '../../domain/entities/%entity%.entity';
import { %Entity%Id } from '../../domain/value-objects/%entity%-id.vo';

import { %Entity%OrmEntity } from './%entity%.orm-entity';

/**
 * Única frontera entre la fila de la tabla y el agregado. Al reconstituir se usa \`rehydrate\` y
 * no \`create\`: los datos ya persistidos no vuelven a pasar por las reglas de creación.
 *
 * Los actores de la traza viajan TAL CUAL, \`null\` incluido: ese \`null\` es un valor legítimo del
 * dominio («no consta quién»), no un hueco que rellenar.
 */
export const %Entity%Mapper = {
  toDomain(row: %Entity%OrmEntity): %Entity% {
    return %Entity%.rehydrate({
      id: %Entity%Id.from(row.id),
      name: row.name,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
    });
  },

  toPersistence(%entityCamel%: %Entity%): %Entity%OrmEntity {
    const snapshot = %entityCamel%.toSnapshot();
    const row = new %Entity%OrmEntity();
    row.id = snapshot.id;
    row.name = snapshot.name;
    row.createdAt = snapshot.createdAt;
    row.updatedAt = snapshot.updatedAt;
    row.createdBy = snapshot.createdBy;
    row.updatedBy = snapshot.updatedBy;
    return row;
  },
};
`);

emit('infrastructure/persistence/%entity%.typeorm.repository.ts', `import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import type { %Entity% } from '../../domain/entities/%entity%.entity';
import { %Entity%Repository } from '../../domain/ports/%entity%.repository';
import type { %Entity%Id } from '../../domain/value-objects/%entity%-id.vo';

import { %Entity%Mapper } from './%entity%.mapper';
import { %Entity%OrmEntity } from './%entity%.orm-entity';

/**
 * Adaptador de salida: implementa el puerto con TypeORM. Es la única clase del módulo que conoce
 * el \`Repository\` del ORM; todo lo que sale de aquí ya es dominio.
 *
 * \`implements\`, NUNCA \`extends\`: la conformidad la garantiza el \`implements\` y solo él —
 * \`ClassProvider.provide\` está tipado como \`any\`, así que el \`useClass\` del module no comprueba
 * nada. Y \`%Entity%Repository\` se importa como VALOR aunque solo aparezca en el \`implements\`,
 * porque es un puerto (lo exige el bloque \`no-restricted-syntax\` de \`eslint.config.mjs\`).
 *
 * ⚠️ Si esta tabla gana un índice único, traduce aquí el \`23505\` de PostgreSQL a un error de
 * dominio: sin eso, una colisión concurrente sale como 500. Ver \`user.typeorm.repository.ts\`.
 */
@Injectable()
export class %Entity%TypeOrmRepository implements %Entity%Repository {
  constructor(
    @InjectRepository(%Entity%OrmEntity)
    private readonly repository: Repository<%Entity%OrmEntity>,
  ) {}

  async findById(id: %Entity%Id): Promise<%Entity% | null> {
    const row = await this.repository.findOne({ where: { id: id.value } });
    return row ? %Entity%Mapper.toDomain(row) : null;
  }

  async save(%entityCamel%: %Entity%): Promise<void> {
    await this.repository.save(%Entity%Mapper.toPersistence(%entityCamel%));
  }
}
`);

emit('infrastructure/http/%context%-domain-exception.filter.ts', `import { Catch, NotFoundException } from '@nestjs/common';

import {
  DomainExceptionFilter,
  type DomainErrorMapping,
} from '@common/http/domain-exception.filter';

import { %Context%DomainError, %Entity%NotFoundError } from '../../domain/errors/%context%.errors';

/**
 * Traduce los errores del dominio al protocolo HTTP: el dominio lanza \`%Entity%NotFoundError\` y
 * es este adaptador quien decide que son 404.
 *
 * El recorrido del mapa —gana el primer \`instanceof\` que coincide, y lo no mapeado cae en un 400—
 * vive en \`DomainExceptionFilter\`. Aquí solo queda la tabla de traducción de este contexto.
 *
 * Las excepciones se construyen con STRING a propósito: así Nest rellena \`body.error\` con el
 * nombre canónico del status, no con el nombre de la clase de dominio.
 *
 * ⚠️ El \`@Catch\` es ANCHO (\`%Context%DomainError\`) y no solo los casos mapeados: un error de
 * dominio nuevo debe salir como 400 por el fallback, nunca como 500.
 */
@Catch(%Context%DomainError)
export class %Context%DomainExceptionFilter extends DomainExceptionFilter<%Context%DomainError> {
  protected readonly mappings: DomainErrorMapping<%Context%DomainError> = [
    [%Entity%NotFoundError, (error) => new NotFoundException(error.message)],
  ];
}
`);

emit('infrastructure/http/dto/%entity%-response.dto.ts', `import { ApiProperty } from '@nestjs/swagger';

import { TIMESTAMP } from '@common/dto/error-example.factory';

import type { %Entity% } from '../../../domain/entities/%entity%.entity';

export class %Entity%ResponseDto {
  @ApiProperty({
    description: 'Identificador de%l% %entity%.',
    example: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({ description: 'Nombre visible.', example: 'Ejemplo' })
  name!: string;

  @ApiProperty({ description: 'Alta, en UTC.', example: TIMESTAMP, type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({
    description: 'Última modificación, en UTC.',
    example: TIMESTAMP,
    type: String,
    format: 'date-time',
  })
  updatedAt!: Date;

  /**
   * El dominio nunca se serializa directamente: siempre pasa por este DTO.
   *
   * ⚠️ La traza de auditoría (\`createdBy\`/\`updatedBy\`) NO se publica. Si tu contrato la necesita,
   * añádela a conciencia: es información sobre quién opera el sistema.
   */
  static fromDomain(%entityCamel%: %Entity%): %Entity%ResponseDto {
    const snapshot = %entityCamel%.toSnapshot();
    const dto = new %Entity%ResponseDto();
    dto.id = snapshot.id;
    dto.name = snapshot.name;
    dto.createdAt = snapshot.createdAt;
    dto.updatedAt = snapshot.updatedAt;
    return dto;
  }
}
`.replaceAll('%l%', 'l'));

emit('infrastructure/http/dto/create-%entity%.dto.ts', `import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Validación de TRANSPORTE. Es la única capa donde \`class-validator\` está permitido: el gate de
 * fronteras lo prohíbe en \`domain/\` y en \`application/\`.
 *
 * ⚠️ Estas reglas y las del dominio NO son las mismas y no tienen por qué serlo, pero conviene
 * saber dónde divergen: \`@MinLength(2)\` mide la cadena SIN recortar, mientras que
 * \`%Entity%.assertName()\` recorta primero. Es decir, \`'  a  '\` pasa el DTO y muere en el dominio
 * — y ahí el filtro lo convierte en 400, que es lo correcto.
 */
export class Create%Entity%Dto {
  @ApiProperty({ description: 'Nombre visible.', example: 'Ejemplo', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}
`);

emit('infrastructure/http/%context%.controller.ts', `import { Body, Controller, Post, UseFilters } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedUser } from '@common/auth/authenticated-user';
import { ApiStandardErrors } from '@common/decorators/api-standard-errors.decorator';
import { Auth } from '@common/decorators/auth.decorator';
import { CurrentUser } from '@common/decorators/current-user.decorator';
import { ApiEnvelope } from '@common/dto/api-envelope.dto';
import { TIMESTAMP } from '@common/dto/error-example.factory';
import { ValidationErrorResponseDto } from '@common/dto/error-response.dto';
import { errorExample, requestMeta } from '@common/dto/openapi-example.helpers';

import { Create%Entity%UseCase } from '../../application/use-cases/create-%entity%.use-case';

import { Create%Entity%Dto } from './dto/create-%entity%.dto';
import { %Entity%ResponseDto } from './dto/%entity%-response.dto';
import { %Context%DomainExceptionFilter } from './%context%-domain-exception.filter';

const COLLECTION_PATH = '/api/v1/%context%';

const %ENTITY%_EXAMPLE = {
  id: '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012',
  name: 'Ejemplo',
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
} as const;

/**
 * Adaptador de entrada (driver). No contiene reglas de negocio: valida el transporte, delega en
 * el caso de uso y traduce el resultado a DTO. Nunca toca el repositorio.
 *
 * ⚠️ **Toda operación debe ir documentada al completo**: \`openapi-contract.e2e-spec.ts\` recorre el
 * documento y ROMPE EL BUILD si falta un \`operationId\`, un \`summary\`, un \`description\`, un
 * ejemplo de respuesta o el ejemplo de un parámetro. Y desde 2026-08-25
 * \`openapi-runtime-contract.e2e-spec.ts\` exige además que la RESPUESTA REAL valide contra el
 * esquema publicado, y que este endpoint tenga su escenario en el guion de esa suite.
 */
@ApiTags('%Context%')
@Controller('%context%')
@UseFilters(%Context%DomainExceptionFilter)
export class %Context%Controller {
  constructor(private readonly create%Entity%: Create%Entity%UseCase) {}

  // El actor de la auditoría sale del \`sub\` del token y JAMÁS del body: criterio anti-spoof.
  @Auth()
  @Post()
  @ApiOperation({
    operationId: 'create%Entity%',
    summary: 'Crea un%l% %entity%',
    description: 'Da de alta un%l% %entity% y devuelve su representación completa.',
  })
  @ApiBody({
    type: Create%Entity%Dto,
    examples: { basico: { summary: 'Alta mínima', value: { name: 'Ejemplo' } } },
  })
  @ApiEnvelope(%Entity%ResponseDto, {
    description: '%Entity% creado.',
    example: {
      success: true,
      data: %ENTITY%_EXAMPLE,
      request: requestMeta(COLLECTION_PATH),
    },
  })
  @ApiBadRequestResponse({
    description: 'El cuerpo no supera la validación de entrada.',
    type: ValidationErrorResponseDto,
    example: errorExample(400, 'name must be longer than or equal to 2 characters', COLLECTION_PATH),
  })
  @ApiStandardErrors()
  async create(
    @Body() dto: Create%Entity%Dto,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<%Entity%ResponseDto> {
    const %entityCamel% = await this.create%Entity%.execute({ name: dto.name, createdBy: actor.sub });
    return %Entity%ResponseDto.fromDomain(%entityCamel%);
  }
}
`.replaceAll('%ENTITY%', C.Entity.toUpperCase()).replaceAll('%l%', ''));

emit('%context%.module.ts', `import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Create%Entity%UseCase } from './application/use-cases/create-%entity%.use-case';
import { %Entity%Repository } from './domain/ports/%entity%.repository';
import { %Context%Controller } from './infrastructure/http/%context%.controller';
import { %Entity%OrmEntity } from './infrastructure/persistence/%entity%.orm-entity';
import { %Entity%TypeOrmRepository } from './infrastructure/persistence/%entity%.typeorm.repository';

/**
 * Composition root del bounded context: aquí, y solo aquí, se une cada puerto del dominio con su
 * adaptador de infraestructura. Cambiar TypeORM por otra cosa se reduce a cambiar el \`useClass\`.
 *
 * ⚠️ Este archivo ES la superficie pública del contexto (regla 3 del gate de fronteras): otro
 * módulo solo puede importar DE AQUÍ, nunca de \`application/\` ni de \`domain/\`. Cuando este
 * contexto tenga que exponer algo, publícalo con una fachada \`abstract class\` re-exportada al
 * final de este archivo — el patrón está en \`users.module.ts\`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([%Entity%OrmEntity])],
  controllers: [%Context%Controller],
  providers: [
    // El token es la propia \`abstract class\` del puerto: quien la declare como tipo de un
    // parámetro de constructor la recibe sin \`@Inject\`.
    { provide: %Entity%Repository, useClass: %Entity%TypeOrmRepository },
    Create%Entity%UseCase,
  ],
})
export class %Context%Module {}
`);

// ────────────────────────────────────────────────────────────────────── tests

emit('__tests__/helpers/in-memory-%entity%.repository.ts', `import type { %Entity% } from '../../domain/entities/%entity%.entity';
import type { %Entity%Repository } from '../../domain/ports/%entity%.repository';
import type { %Entity%Id } from '../../domain/value-objects/%entity%-id.vo';

/**
 * Fake escrito a mano del puerto, NO un mock generado. Se comporta como un repositorio real
 * (guarda, sobrescribe por id) para que el test valide el caso de uso y no la configuración de
 * un doble. En \`application/\` los dobles se escriben así, nunca con \`jest.mock\`.
 */
export class InMemory%Entity%Repository implements %Entity%Repository {
  private readonly store = new Map<string, %Entity%>();

  constructor(seed: %Entity%[] = []) {
    seed.forEach((item) => this.store.set(item.id.value, item));
  }

  findById(id: %Entity%Id): Promise<%Entity% | null> {
    return Promise.resolve(this.store.get(id.value) ?? null);
  }

  save(%entityCamel%: %Entity%): Promise<void> {
    this.store.set(%entityCamel%.id.value, %entityCamel%);
    return Promise.resolve();
  }

  /** Solo para aserciones del test, no forma parte del puerto. */
  size(): number {
    return this.store.size;
  }
}
`);

emit('__tests__/domain/entities/%entity%.entity.spec.ts', `import { Invalid%Entity%NameError } from '../../../domain/errors/%context%.errors';
import { %Entity% } from '../../../domain/entities/%entity%.entity';
import { %Entity%Id } from '../../../domain/value-objects/%entity%-id.vo';

const NOW = new Date('2026-01-01T00:00:00.000Z');
const LATER = new Date('2026-02-02T00:00:00.000Z');
const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('%Entity%', () => {
  describe('create()', () => {
    it('debería nacer con las dos marcas de tiempo iguales', () => {
      // Arrange & Act
      const %entityCamel% = build();

      // Assert
      expect(%entityCamel%.createdAt).toEqual(NOW);
      expect(%entityCamel%.updatedAt).toEqual(NOW);
    });

    it('debería nacer con createdBy y updatedBy iguales al actor recibido', () => {
      // Arrange & Act
      const %entityCamel% = build({ createdBy: ACTOR });

      // Assert
      // Quien creó la fila es, hasta el primer \`touch()\`, el último que la escribió. Ponerlo a
      // \`null\` diría que nadie la ha tocado nunca, y sería falso.
      expect(%entityCamel%.createdBy).toBe(ACTOR);
      expect(%entityCamel%.updatedBy).toBe(ACTOR);
    });

    it('debería recortar los espacios del nombre', () => {
      // Arrange & Act
      const %entityCamel% = build({ name: '  Ejemplo  ' });

      // Assert
      expect(%entityCamel%.name).toBe('Ejemplo');
    });

    it.each([['vacío', ''], ['de un solo carácter', 'a'], ['solo espacios', '   ']])(
      'debería rechazar un nombre %s',
      (_caso, name) => {
        // Arrange & Act & Assert
        expect(() => build({ name })).toThrow(Invalid%Entity%NameError);
      },
    );
  });

  describe('rename()', () => {
    it('debería cambiar el nombre y avanzar la traza', () => {
      // Arrange
      const %entityCamel% = build();

      // Act
      %entityCamel%.rename('Otro Nombre', LATER, ACTOR);

      // Assert
      expect(%entityCamel%.name).toBe('Otro Nombre');
      expect(%entityCamel%.updatedAt).toEqual(LATER);
      expect(%entityCamel%.updatedBy).toBe(ACTOR);
    });

    it('debería no tocar la traza al renombrar con el mismo nombre', () => {
      // Arrange
      const %entityCamel% = build({ name: 'Ejemplo' });

      // Act
      %entityCamel%.rename('Ejemplo', LATER, ACTOR);

      // Assert
      // El corte es ANTES del \`touch\`, así que una operación sin efecto tampoco reescribe el
      // actor: la traza sigue nombrando a quien cambió algo de verdad.
      expect(%entityCamel%.updatedAt).toEqual(NOW);
      expect(%entityCamel%.updatedBy).toBeNull();
    });
  });

  describe('toSnapshot()', () => {
    it('debería exponer primitivos en lugar de value objects', () => {
      // Arrange
      const %entityCamel% = build();

      // Act
      const snapshot = %entityCamel%.toSnapshot();

      // Assert
      expect(typeof snapshot.id).toBe('string');
      expect(snapshot.name).toBe('Ejemplo');
    });

    it('debería sobrevivir al round-trip snapshot -> rehydrate', () => {
      // Arrange
      const original = build({ createdBy: ACTOR });

      // Act
      const revived = %Entity%.rehydrate({
        ...original.toSnapshot(),
        id: %Entity%Id.from(original.id.value),
      });

      // Assert
      expect(revived.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});

// Helpers

const build = ({ name = 'Ejemplo', createdBy = null }: { name?: string; createdBy?: string | null } = {}): %Entity% =>
  %Entity%.create({ id: %Entity%Id.generate(), name, now: NOW, createdBy });
`);

emit('__tests__/domain/value-objects/%entity%-id.vo.spec.ts', `import { Invalid%Entity%IdError } from '../../../domain/errors/%context%.errors';
import { %Entity%Id } from '../../../domain/value-objects/%entity%-id.vo';

const VALID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';

describe('%Entity%Id', () => {
  describe('from()', () => {
    it('debería aceptar un UUID v4 válido', () => {
      // Arrange & Act
      const id = %Entity%Id.from(VALID);

      // Assert
      expect(id.value).toBe(VALID);
    });

    it.each([
      ['una cadena cualquiera', 'no-es-uuid'],
      ['un UUID v1', '9d2a1c7e-1f6b-1a2e-9c3d-77a1b0e5f012'],
      ['una cadena vacía', ''],
    ])('debería rechazar %s', (_caso, value) => {
      // Arrange & Act & Assert
      expect(() => %Entity%Id.from(value)).toThrow(Invalid%Entity%IdError);
    });
  });

  describe('generate()', () => {
    it('debería acuñar un identificador distinto en cada llamada', () => {
      // Arrange & Act
      const first = %Entity%Id.generate();
      const second = %Entity%Id.generate();

      // Assert
      expect(first.equals(second)).toBe(false);
    });
  });
});
`);

emit('__tests__/application/use-cases/create-%entity%.use-case.spec.ts', `import { Create%Entity%UseCase } from '../../../application/use-cases/create-%entity%.use-case';
import { InMemory%Entity%Repository } from '../../helpers/in-memory-%entity%.repository';

const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('Create%Entity%UseCase', () => {
  describe('execute()', () => {
    it('debería persistir el agregado creado', async () => {
      // Arrange
      const { useCase, repository } = build();

      // Act
      await useCase.execute({ name: 'Ejemplo', createdBy: ACTOR });

      // Assert
      expect(repository.size()).toBe(1);
    });

    it('debería devolver el agregado con el nombre recibido', async () => {
      // Arrange
      const { useCase } = build();

      // Act
      const created = await useCase.execute({ name: 'Ejemplo', createdBy: ACTOR });

      // Assert
      expect(created.name).toBe('Ejemplo');
    });

    it('debería firmar la traza con el actor recibido', async () => {
      // Arrange
      const { useCase } = build();

      // Act
      const created = await useCase.execute({ name: 'Ejemplo', createdBy: ACTOR });

      // Assert
      expect(created.createdBy).toBe(ACTOR);
      expect(created.updatedBy).toBe(ACTOR);
    });

    it('debería poder recuperarse por su id desde el repositorio', async () => {
      // Arrange
      const { useCase, repository } = build();

      // Act
      const created = await useCase.execute({ name: 'Ejemplo', createdBy: null });

      // Assert
      // Sin esto, un \`save()\` que guardara con la clave equivocada pasaría desapercibido:
      // \`size()\` valdría 1 igual.
      await expect(repository.findById(created.id)).resolves.not.toBeNull();
    });
  });
});

// Helpers

const build = (): { useCase: Create%Entity%UseCase; repository: InMemory%Entity%Repository } => {
  const repository = new InMemory%Entity%Repository();
  return { useCase: new Create%Entity%UseCase(repository), repository };
};
`);

emit('__tests__/infrastructure/persistence/%entity%.mapper.spec.ts', `import { %Entity% } from '../../../domain/entities/%entity%.entity';
import { %Entity%Id } from '../../../domain/value-objects/%entity%-id.vo';
import { %Entity%Mapper } from '../../../infrastructure/persistence/%entity%.mapper';
import { %Entity%OrmEntity } from '../../../infrastructure/persistence/%entity%.orm-entity';

const ID = '9d2a1c7e-1f6b-4a2e-9c3d-77a1b0e5f012';
const NOW = new Date('2026-01-01T00:00:00.000Z');
const ACTOR = '5b7c2d4e-9a1f-4c3b-8e6d-0f2a4b6c8d1e';

describe('%Entity%Mapper', () => {
  describe('toDomain()', () => {
    it('debería reconstituir el agregado desde la fila', () => {
      // Arrange
      const row = buildRow();

      // Act
      const %entityCamel% = %Entity%Mapper.toDomain(row);

      // Assert
      expect(%entityCamel%.id.value).toBe(ID);
      expect(%entityCamel%.name).toBe('Ejemplo');
    });

    it('debería conservar el null de los actores en vez de coalescerlo', () => {
      // Arrange
      const row = buildRow({ createdBy: null, updatedBy: null });

      // Act
      const %entityCamel% = %Entity%Mapper.toDomain(row);

      // Assert
      // El \`null\` de la columna significa «no consta quién» y es un valor legítimo del dominio.
      expect(%entityCamel%.createdBy).toBeNull();
    });
  });

  describe('toPersistence()', () => {
    it('debería trasladar todos los campos del snapshot a la fila', () => {
      // Arrange
      const %entityCamel% = %Entity%.create({
        id: %Entity%Id.from(ID),
        name: 'Ejemplo',
        now: NOW,
        createdBy: ACTOR,
      });

      // Act
      const row = %Entity%Mapper.toPersistence(%entityCamel%);

      // Assert
      // Campo a campo y no con \`toMatchObject\`: lo que se comprueba es que NINGUNO se queda
      // atrás, que es el defecto típico al añadir una columna.
      expect(row).toEqual({
        id: ID,
        name: 'Ejemplo',
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: ACTOR,
        updatedBy: ACTOR,
      });
    });
  });

  describe('ida y vuelta', () => {
    it('debería sobrevivir a toPersistence -> toDomain sin perder nada', () => {
      // Arrange
      const original = %Entity%.create({
        id: %Entity%Id.from(ID),
        name: 'Ejemplo',
        now: NOW,
        createdBy: ACTOR,
      });

      // Act
      const revived = %Entity%Mapper.toDomain(%Entity%Mapper.toPersistence(original));

      // Assert
      expect(revived.toSnapshot()).toEqual(original.toSnapshot());
    });
  });
});

// Helpers

const buildRow = (
  overrides: Partial<%Entity%OrmEntity> = {},
): %Entity%OrmEntity => Object.assign(new %Entity%OrmEntity(), {
  id: ID,
  name: 'Ejemplo',
  createdAt: NOW,
  updatedAt: NOW,
  createdBy: ACTOR,
  updatedBy: ACTOR,
  ...overrides,
});
`);

emit('__tests__/infrastructure/http/%context%-domain-exception.filter.spec.ts', `import { BadRequestException, NotFoundException } from '@nestjs/common';

import { Invalid%Entity%NameError, %Entity%NotFoundError } from '../../../domain/errors/%context%.errors';
import { %Context%DomainExceptionFilter } from '../../../infrastructure/http/%context%-domain-exception.filter';

describe('%Context%DomainExceptionFilter', () => {
  describe('catch()', () => {
    it('debería traducir %Entity%NotFoundError a 404', () => {
      // Arrange
      const filter = new %Context%DomainExceptionFilter();

      // Act & Assert
      expect(() => filter.catch(new %Entity%NotFoundError('id-x'))).toThrow(NotFoundException);
    });

    it('debería traducir a 400 cualquier error de dominio no mapeado', () => {
      // Arrange
      const filter = new %Context%DomainExceptionFilter();

      // Act & Assert
      // El fallback es deliberado, no un descuido: un error de dominio nuevo debe salir como 400
      // —el cliente mandó algo que el dominio rechaza— y nunca como 500.
      expect(() => filter.catch(new Invalid%Entity%NameError('a'))).toThrow(BadRequestException);
    });

    it('debería conservar el mensaje del dominio en la excepción HTTP', () => {
      // Arrange
      const filter = new %Context%DomainExceptionFilter();

      // Act & Assert
      expect(() => filter.catch(new %Entity%NotFoundError('id-x'))).toThrow('%Entity% id-x was not found');
    });
  });
});
`);

// ─────────────────────────────────────────────────────────── formato y salida

/**
 * Prettier sobre lo emitido, en vez de plantillas escritas «ya formateadas».
 *
 * Es deliberado: acertar a mano con dónde parte prettier una llamada de tres argumentos o un
 * objeto largo es adivinar, y cada plantilla nueva volvería a fallar. Medido — la primera versión
 * de este generador producía un módulo con `typecheck` y el GATE DE FRONTERAS en verde y **19
 * errores de `prettier/prettier`**, todos de salto de línea y ninguno de fondo.
 *
 * Si prettier no estuviera disponible el módulo sigue generado y basta con `pnpm format`, así que
 * el fallo se avisa y no aborta.
 */
try {
  execFileSync('npx', ['prettier', '--write', `src/modules/${C.context}/**/*.ts`], {
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
} catch {
  console.warn('⚠️  No se pudo ejecutar prettier. Corre `pnpm format` antes de commitear.');
}


console.log(`\n✔ Módulo \`${C.context}\` generado (entidad \`${C.entity}\`, tabla \`${C.table}\`).\n`);
for (const file of created) {
  console.log(`   ${file}`);
}
console.log(`\n⚠️  Quedan TRES cosas a mano, y el generador no las hace a propósito:\n`);
console.log(`   1. Registrar el módulo:  añade \`${C.Context}Module\` a los \`imports\` de src/app.module.ts`);
console.log(`   2. El scope de commit:   añade '${C.context}' a la lista CERRADA de commitlint.config.cjs`);
console.log(`   3. La migración:         pnpm migration:generate src/database/migrations/Create${C.Context}`);
console.log(`                            y luego  pnpm migration:run  +  pnpm db:migrate:test\n`);
console.log(`   Y un cuarto que sí rompe el build si se olvida: cuando el endpoint exista de verdad,`);
console.log(`   añade su escenario a src/bootstrap/__tests__/openapi-runtime-contract.e2e-spec.ts.\n`);
console.log(`Después:  pnpm typecheck && pnpm lint:check && pnpm format && pnpm test\n`);
