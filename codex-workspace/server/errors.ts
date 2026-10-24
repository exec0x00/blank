export class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); this.name = 'HttpError'; }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'An unexpected error occurred';
}
