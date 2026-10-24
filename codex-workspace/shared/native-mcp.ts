/** Browser presentation for native MCP. Native callback identities and proofs
 * remain on the server; these opaque IDs expire with their connection. */
export type McpValue = null | boolean | number | string | McpValue[] | { [key: string]: McpValue };

export interface NativeMcpField {
  key: string;
  label: string;
  description?: string;
  kind: 'string' | 'number' | 'integer' | 'boolean' | 'select' | 'multiselect' | 'object' | 'array' | 'constant';
  required: boolean;
  secret?: boolean;
  format?: 'email' | 'uri' | 'date' | 'date-time';
  choices?: Array<{ value: McpValue; label: string }>;
  fields?: NativeMcpField[];
  item?: NativeMcpField;
  defaultValue?: McpValue;
  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
  minProperties?: number;
  maxProperties?: number;
  additionalProperties?: boolean;
}
export interface NativeMcpForm { field: NativeMcpField | null; unavailableReason: string | null }
export interface NativeMcpServer {
  id: string;
  name: string;
  status: string;
  authentication: string;
  origin: string | null;
  description: string | null;
  toolCount: number;
  resourceCount: number;
  templateCount: number;
  canStream: boolean;
  toolError: string | null;
}
export interface NativeMcpInventory { servers: NativeMcpServer[]; nextCursor: string | null; checkedAt: string }
export interface NativeMcpTool { id: string; name: string; description: string; form: NativeMcpForm; readOnly: boolean; destructive: boolean }
export interface NativeMcpResource { id: string; name: string; description: string; uri: string; mimeType: string | null; template: boolean }
export interface NativeMcpCatalog {
  tools: NativeMcpTool[];
  resources: NativeMcpResource[];
  nextOffset: number | null;
  total: number;
}
export interface NativeMcpContent {
  kind: 'text' | 'link' | 'image' | 'audio' | 'binary' | 'data';
  text?: string;
  url?: string;
  label?: string;
  mimeType?: string;
  data?: McpValue;
  truncated?: boolean;
}
export interface NativeMcpResult { content: NativeMcpContent[]; isError: boolean; truncated: boolean }
export interface NativeMcpElicitation {
  id: string;
  threadId: string;
  threadTitle?: string;
  serverName: string;
  mode: 'form' | 'openai/form' | 'openaiForm' | 'url' | 'openai/userVerification';
  message: string;
  title: string;
  form?: NativeMcpForm;
  url?: string;
  urlOrigin?: string;
  unavailableReason: string | null;
  verification?: 'pending' | 'verifying' | 'verified' | 'unavailable';
  canCancelVerification?: boolean;
  expiresAt: string;
}
export interface NativeMcpSubscription {
  id: string;
  serverName: string;
  name: string;
  state: 'starting' | 'active' | 'stopping' | 'uncertain' | 'ended';
  events: Array<{ id: string; time: string; name: string; content: NativeMcpContent[] }>;
  expiresAt: string;
}
export interface NativeMcpVerificationStatus {
  available: boolean;
  enrolled: boolean;
  reason: string | null;
  canEnroll: boolean;
  canDelete: boolean;
  canVerify: boolean;
}
export interface NativeMcpState {
  connected: boolean;
  oauthUnavailableReason?: string | null;
  capabilities: { inventory: boolean; reload: boolean; oauth: boolean; resources: boolean; tools: boolean; events: boolean; elicitation: boolean; verification: boolean };
  requests: NativeMcpElicitation[];
  subscriptions: NativeMcpSubscription[];
  notices: Array<{ id: string; message: string; error: boolean }>;
}
