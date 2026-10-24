import type { CodexQuestionRequest } from '../../../shared/codex-cli';

type Question = CodexQuestionRequest['questions'][number];
export interface QuestionDraft {
  key: string;
  choices: Record<string, number | 'other'>;
  text: Record<string, string>;
  secretPresent: Record<string, boolean>;
}
export const emptyQuestionDraft = (key: string): QuestionDraft => ({ key, choices: {}, text: {}, secretPresent: {} });

/** Changing a native request definition invalidates answers to its old choices. */
export function questionRequestKey(request: CodexQuestionRequest): string {
  return JSON.stringify([request.threadId, request.turnId, request.itemId, request.id, request.isBlocking, request.questions]);
}

/** No option is selected implicitly, including options labelled Recommended. */
export function questionTextAnswer(question: Question, draft: QuestionDraft): string | undefined {
  if (question.isSecret) return undefined;
  if (!question.options?.length) return draft.text[question.id]?.trim() || undefined;
  const choice = draft.choices[question.id];
  if (choice === 'other') return question.isOther ? draft.text[question.id]?.trim() || undefined : undefined;
  return typeof choice === 'number' && Number.isInteger(choice) && choice >= 0 ? question.options[choice]?.label || undefined : undefined;
}

export function questionIsAnswered(question: Question, draft: QuestionDraft): boolean {
  return question.isSecret ? draft.secretPresent[question.id] === true : questionTextAnswer(question, draft) !== undefined;
}

export function requestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message.slice(0, 1200) : fallback;
}
