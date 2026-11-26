import type { Direction } from './keys.js';
export type Field = {
    name: string;
    /**
     * Its C type: `uint16_t`, `struct GP_SHOP`, `union Data`, `enum GP_GAME_ECODE`.
     */
    type_name: string;
    /**
     * An array's element type; the type itself otherwise.
     */
    base_type: string;
    /**
     * Its width, or an array element's. 0 means `size_bytes` wide.
     */
    bits?: number;
    signed?: boolean;
    /**
     * The whole field's size, every element of an array.
     */
    size_bytes?: number;
    /**
     * Its element count, for an array; a `char` array is text.
     */
    array_size?: number | null;
    hints?: Hints;
    is_enum?: boolean;
    enum_underlying_type?: string | null;
    is_union?: boolean;
    /**
     * A struct's fields, or each array element's.
     */
    nested_fields?: Field[] | null;
    union_variants?: UnionVariant[] | null;
    /**
     * The earlier sibling whose value picks the variant.
     */
    discriminator_field?: string | null;
};
export type Hints = {
    /**
     * As `bits`.
     */
    type?: string;
    /**
     * With `type: 'bits'`, as `32`.
     */
    bits?: string;
    /**
     * As `zones`, `music`, `@uniqueno`.
     */
    lookup?: string;
    /**
     * As `@ActIndex`.
     */
    save?: string | string[];
};
export type UnionVariant = {
    name: string;
    discriminator_value: number;
    fields: Field[];
};
export type Schema = {
    /**
     * As `GP_SERV_COMMAND_BATTLE2`.
     */
    name: string;
    /**
     * The opcode in hex, as `0x0028`.
     */
    id: string;
    fields: Field[];
};
export type OlderSchema = Schema & {
    direction: string;
    until?: string;
    from?: string;
};
export type Schemas = {
    s2c: Schema[];
    c2s: Schema[];
    layouts?: OlderSchema[];
};
export type IndexedOlderSchema = Schema & {
    direction: Direction;
    packetId: number;
    until?: string;
    from?: string;
};
export type SchemaIndex = {
    0: Map<number, Schema>;
    1: Map<number, Schema>;
    older: IndexedOlderSchema[];
};
/**
 * Builds the lookup from the parsed JSON files.
 * @param {Schemas} schemas
 * @returns {SchemaIndex}
 */
export declare function setSchemas({ s2c, c2s, layouts }: Schemas): SchemaIndex;
/**
 * Fetches the JSON files from `base`, as Lens serves them.
 * @param {string} [base]
 * @returns {Promise<SchemaIndex>}
 */
export declare function loadSchemas(base?: string): Promise<SchemaIndex>;
export type Version = [number, number];
/**
 * The layout of this opcode for this client version, or null for an opcode no layout covers or before
 * loadSchemas or setSchemas.
 * @param {Direction} direction
 * @param {number} packetId
 * @param {string} [clientVersion] As `30251101_2`; anything else gets today's layouts.
 * @returns {Schema | null}
 */
export declare function lookup(direction: Direction, packetId: number, clientVersion?: string): Schema | null;
/**
 * The packetKey of every packet type with a field of this name, at any depth, custom decoders'
 * fields included.
 * @param {string} fieldName
 * @returns {Set<number>}
 */
export declare function findPacketTypesWithField(fieldName: string): Set<number>;
