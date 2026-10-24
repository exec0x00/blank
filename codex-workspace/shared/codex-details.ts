/** Public bounded views of actual native Codex items; no protocol/private bodies. */
export type NativeItemDetailField = 'text' | 'input' | 'output';
export interface NativeItemDetailRequest {
  threadId: string; turnId: string; itemId: string; field: NativeItemDetailField;
  /** Native ascending-page cursor, including explicit null for the first page. */
  cursor?: string | null;
  part?: number; offset?: number; limit?: number;
  /** Pin later part/offset reads to the previously returned public item version. */
  version?: string;
}
export interface NativeItemDetailPart { part: number; label: string; totalChars: number }
interface NativeItemDetailIdentity { threadId: string; turnId: string; itemId: string; field: NativeItemDetailField }
export interface NativeItemDetailSearching extends NativeItemDetailIdentity {
  status: 'searching'; nextCursor: string; pagesScanned: number;
}
export interface NativeItemDetailReady extends NativeItemDetailIdentity {
  status: 'ready'; itemType: string; itemCursor: string | null; parts: NativeItemDetailPart[];
  part: number; label: string; text: string; totalChars: number; offset: number; limit: number;
  previousOffset: number | null; nextOffset: number | null; version: string;
}
export interface NativeItemDetailUnavailable extends NativeItemDetailIdentity {
  status: 'unavailable'; itemType: string; itemCursor: string | null;
  reason: 'unsupported-field' | 'no-public-content'; message: string;
}
export interface NativeItemDetailNotFound extends NativeItemDetailIdentity {
  status: 'notFound'; nextCursor: null; message: string;
}
export type NativeItemDetail = NativeItemDetailSearching | NativeItemDetailReady | NativeItemDetailUnavailable | NativeItemDetailNotFound;
