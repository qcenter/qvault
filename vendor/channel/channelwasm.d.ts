/* tslint:disable */
/* eslint-disable */

export function js_decrypt_inbox_message(input: string): string;

export function js_double_ratchet_decrypt(params: string): string;

export function js_double_ratchet_encrypt(params: string): string;

export function js_encrypt_inbox_message(input: string): string;

export function js_generate_ed448(): string;

export function js_generate_x448(): string;

export function js_get_pubkey_ed448(key: string): string;

export function js_get_pubkey_x448(key: string): string;

export function js_new_double_ratchet(params: string): string;

export function js_new_triple_ratchet(params: string): string;

export function js_receiver_x3dh(input: string): string;

export function js_sender_x3dh(input: string): string;

export function js_sign_ed448(key: string, message: string): string;

export function js_triple_ratchet_decrypt(params: string): string;

export function js_triple_ratchet_encrypt(params: string): string;

export function js_triple_ratchet_init_round_1(params: string): string;

export function js_triple_ratchet_init_round_2(params: string): string;

export function js_triple_ratchet_init_round_3(params: string): string;

export function js_triple_ratchet_init_round_4(params: string): string;

export function js_triple_ratchet_resize(params: string): string;

export function js_verify_ed448(public_key: string, message: string, signature: string): string;

export function js_verify_point(params: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly js_decrypt_inbox_message: (a: number, b: number) => [number, number];
    readonly js_double_ratchet_decrypt: (a: number, b: number) => [number, number];
    readonly js_double_ratchet_encrypt: (a: number, b: number) => [number, number];
    readonly js_encrypt_inbox_message: (a: number, b: number) => [number, number];
    readonly js_generate_ed448: () => [number, number];
    readonly js_generate_x448: () => [number, number];
    readonly js_get_pubkey_ed448: (a: number, b: number) => [number, number];
    readonly js_get_pubkey_x448: (a: number, b: number) => [number, number];
    readonly js_new_double_ratchet: (a: number, b: number) => [number, number];
    readonly js_new_triple_ratchet: (a: number, b: number) => [number, number];
    readonly js_receiver_x3dh: (a: number, b: number) => [number, number];
    readonly js_sender_x3dh: (a: number, b: number) => [number, number];
    readonly js_sign_ed448: (a: number, b: number, c: number, d: number) => [number, number];
    readonly js_triple_ratchet_decrypt: (a: number, b: number) => [number, number];
    readonly js_triple_ratchet_encrypt: (a: number, b: number) => [number, number];
    readonly js_triple_ratchet_init_round_1: (a: number, b: number) => [number, number];
    readonly js_triple_ratchet_init_round_2: (a: number, b: number) => [number, number];
    readonly js_triple_ratchet_init_round_3: (a: number, b: number) => [number, number];
    readonly js_triple_ratchet_init_round_4: (a: number, b: number) => [number, number];
    readonly js_triple_ratchet_resize: (a: number, b: number) => [number, number];
    readonly js_verify_ed448: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly js_verify_point: (a: number, b: number) => [number, number];
    readonly ffi_channel_rust_future_cancel_f32: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_f64: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_i16: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_i32: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_i64: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_i8: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_pointer: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_rust_buffer: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_u16: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_u32: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_u64: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_u8: (a: bigint) => void;
    readonly ffi_channel_rust_future_cancel_void: (a: bigint) => void;
    readonly ffi_channel_rust_future_complete_f32: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_f64: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_i16: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_i32: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_i64: (a: bigint, b: number) => bigint;
    readonly ffi_channel_rust_future_complete_i8: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_pointer: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_rust_buffer: (a: number, b: bigint, c: number) => void;
    readonly ffi_channel_rust_future_complete_u16: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_u32: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_u64: (a: bigint, b: number) => bigint;
    readonly ffi_channel_rust_future_complete_u8: (a: bigint, b: number) => number;
    readonly ffi_channel_rust_future_complete_void: (a: bigint, b: number) => void;
    readonly ffi_channel_rust_future_free_f32: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_f64: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_i16: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_i32: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_i64: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_i8: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_pointer: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_rust_buffer: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_u16: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_u32: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_u64: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_u8: (a: bigint) => void;
    readonly ffi_channel_rust_future_free_void: (a: bigint) => void;
    readonly ffi_channel_rust_future_poll_f32: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_f64: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_i16: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_i32: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_i64: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_i8: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_pointer: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_rust_buffer: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_u16: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_u32: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_u64: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_u8: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rust_future_poll_void: (a: bigint, b: number, c: bigint) => void;
    readonly ffi_channel_rustbuffer_alloc: (a: number, b: bigint, c: number) => void;
    readonly ffi_channel_rustbuffer_free: (a: number, b: number) => void;
    readonly ffi_channel_rustbuffer_from_bytes: (a: number, b: number, c: number) => void;
    readonly ffi_channel_rustbuffer_reserve: (a: number, b: number, c: bigint, d: number) => void;
    readonly ffi_channel_uniffi_contract_version: () => number;
    readonly uniffi_channel_checksum_func_decrypt_inbox_message: () => number;
    readonly uniffi_channel_checksum_func_double_ratchet_decrypt: () => number;
    readonly uniffi_channel_checksum_func_double_ratchet_encrypt: () => number;
    readonly uniffi_channel_checksum_func_encrypt_inbox_message: () => number;
    readonly uniffi_channel_checksum_func_generate_ed448: () => number;
    readonly uniffi_channel_checksum_func_generate_x448: () => number;
    readonly uniffi_channel_checksum_func_get_pubkey_ed448: () => number;
    readonly uniffi_channel_checksum_func_get_pubkey_x448: () => number;
    readonly uniffi_channel_checksum_func_new_double_ratchet: () => number;
    readonly uniffi_channel_checksum_func_new_triple_ratchet: () => number;
    readonly uniffi_channel_checksum_func_receiver_x3dh: () => number;
    readonly uniffi_channel_checksum_func_sender_x3dh: () => number;
    readonly uniffi_channel_checksum_func_sign_ed448: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_decrypt: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_encrypt: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_init_round_1: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_init_round_2: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_init_round_3: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_init_round_4: () => number;
    readonly uniffi_channel_checksum_func_triple_ratchet_resize: () => number;
    readonly uniffi_channel_checksum_func_verify_ed448: () => number;
    readonly uniffi_channel_fn_func_decrypt_inbox_message: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_double_ratchet_decrypt: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_double_ratchet_encrypt: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_encrypt_inbox_message: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_generate_ed448: (a: number, b: number) => void;
    readonly uniffi_channel_fn_func_generate_x448: (a: number, b: number) => void;
    readonly uniffi_channel_fn_func_get_pubkey_ed448: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_get_pubkey_x448: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_new_double_ratchet: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => void;
    readonly uniffi_channel_fn_func_new_triple_ratchet: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number, h: number) => void;
    readonly uniffi_channel_fn_func_receiver_x3dh: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number) => void;
    readonly uniffi_channel_fn_func_sender_x3dh: (a: number, b: number, c: number, d: number, e: number, f: bigint, g: number) => void;
    readonly uniffi_channel_fn_func_sign_ed448: (a: number, b: number, c: number, d: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_decrypt: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_encrypt: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_init_round_1: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_init_round_2: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_init_round_3: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_init_round_4: (a: number, b: number, c: number) => void;
    readonly uniffi_channel_fn_func_triple_ratchet_resize: (a: number, b: number, c: number, d: bigint, e: bigint, f: number) => void;
    readonly uniffi_channel_fn_func_verify_ed448: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
