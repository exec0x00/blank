import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, Check, CircleHelp, KeyRound, LoaderCircle, RefreshCw } from 'lucide-react';
import type { CodexQuestionRequest } from '../../../shared/codex-cli';
import { RequestDialog, RequestError, RequestSummary } from './RequestDialog';
import { emptyQuestionDraft, questionIsAnswered, questionRequestKey, questionTextAnswer, requestErrorMessage, type QuestionDraft } from './request-presentation';

export type QuestionAnswers = Record<string, { answers: string[] }>;

export function QuestionCard({ request, busy, locked = false, onAnswer, onRefresh }: {
  request: CodexQuestionRequest; busy: boolean; locked?: boolean; onAnswer: (answers: QuestionAnswers) => Promise<void>;
  onRefresh?: () => void | Promise<void>;
}) {
  const uid = useId(), key = questionRequestKey(request);
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<QuestionDraft>(() => emptyQuestionDraft(key));
  const [opened, setOpened] = useState<string | null>(null), [step, setStep] = useState(0);
  const [failure, setFailure] = useState<string | null>(null), [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false), [refreshing, setRefreshing] = useState(false), [eventLocked, setEventLocked] = useState(false);
  const blocked = locked || eventLocked;
  const current = draft.key === key ? draft : emptyQuestionDraft(key);
  const activeStep = Math.min(step, Math.max(0, request.questions.length - 1));
  const answeredCount = request.questions.filter(question => questionIsAnswered(question, current)).length;
  const answered = request.questions.length > 0 && answeredCount === request.questions.length;
  const containsSecret = request.questions.some(question => question.isSecret);
  const scope = useRef({ key, blocked }); scope.current = { key, blocked };
  const alive = useRef(true), operation = useRef<symbol | null>(null), refreshOperation = useRef<symbol | null>(null);
  const secretAnswer = useRef<{ answers: QuestionAnswers; ids: string[] } | null>(null);
  const open = opened === key && !blocked;
  const disabled = busy || pending || sent || refreshing;

  function clearSecretValues() {
    for (const input of form.current?.querySelectorAll<HTMLInputElement>('input[type=password]') ?? []) input.value = '';
    if (secretAnswer.current) for (const id of secretAnswer.current.ids) delete secretAnswer.current.answers[id];
    secretAnswer.current = null;
  }
  function clearSecrets() { clearSecretValues(); setDraft(previous => ({ ...previous, secretPresent: {} })); }
  function close() { clearSecrets(); setOpened(null); }
  const isCurrent = (captured: string) => alive.current && scope.current.key === captured && !scope.current.blocked && document.body.dataset.workspaceLocked !== 'true';

  useLayoutEffect(() => {
    clearSecretValues(); operation.current = null; refreshOperation.current = null;
    setDraft(emptyQuestionDraft(key)); setStep(0); setOpened(null); setFailure(null); setPending(false); setSent(false); setRefreshing(false);
  }, [key, blocked]);
  useEffect(() => {
    alive.current = true;
    const lock = () => { scope.current.blocked = true; clearSecretValues(); setEventLocked(true); };
    const unlock = () => setEventLocked(false);
    window.addEventListener('codex:session-locked', lock); window.addEventListener('codex:session-expired', lock); window.addEventListener('codex:session-unlocked', unlock);
    return () => {
      alive.current = false; clearSecretValues(); operation.current = null; refreshOperation.current = null;
      window.removeEventListener('codex:session-locked', lock); window.removeEventListener('codex:session-expired', lock); window.removeEventListener('codex:session-unlocked', unlock);
    };
  }, []);

  function update(kind: 'choices' | 'text' | 'secretPresent', id: string, value: string | number | boolean) {
    setDraft(previous => ({ ...(previous.key === key ? previous : emptyQuestionDraft(key)),
      [kind]: { ...(previous.key === key ? previous[kind] : {}), [id]: value } }));
  }
  function goTo(index: number) {
    setStep(index);
    requestAnimationFrame(() => {
      if (!isCurrent(key)) return;
      form.current?.querySelector<HTMLElement>('[data-question-step="' + index + '"] legend')?.focus();
    });
  }
  async function refresh() {
    if (!onRefresh || refreshOperation.current || pending || !isCurrent(key)) return;
    const token = Symbol('refresh-question'); refreshOperation.current = token; setRefreshing(true);
    try { await onRefresh(); }
    catch (error) { if (isCurrent(key) && refreshOperation.current === token) setFailure(containsSecret ? 'The request could not be refreshed. Try checking it again.' : requestErrorMessage(error, 'The request could not be refreshed.')); }
    finally { if (isCurrent(key) && refreshOperation.current === token) { refreshOperation.current = null; setRefreshing(false); } }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled || operation.current || !answered || !isCurrent(key)) return;
    const fields = new FormData(event.currentTarget);
    const answers: QuestionAnswers = Object.fromEntries(request.questions.map(question => {
      const value = question.isSecret ? String(fields.get('secret-' + question.id) ?? '') : questionTextAnswer(question, current) ?? '';
      return [question.id, { answers: value ? [value] : [] }];
    }));
    // A cleared native password input cannot be replaced by its presence flag.
    if (Object.values(answers).some(answer => !answer.answers.length)) { clearSecrets(); return; }
    const token = Symbol('answer-question'); operation.current = token;
    secretAnswer.current = { answers, ids: request.questions.filter(question => question.isSecret).map(question => question.id) };
    setFailure(null); setPending(true);
    try { await onAnswer(answers); if (isCurrent(key) && operation.current === token) setSent(true); }
    catch (error) {
      if (isCurrent(key) && operation.current === token) setFailure(containsSecret
        ? 'The answer could not be confirmed. Secret fields were cleared. Check the request before retrying.'
        : requestErrorMessage(error, 'The answer could not be confirmed. Check the request before retrying.'));
    } finally {
      for (const question of request.questions) if (question.isSecret) delete answers[question.id];
      if (isCurrent(key) && operation.current === token) { operation.current = null; clearSecrets(); setPending(false); }
    }
  }

  if (blocked) return null;
  return <>
    <section className="chat-question native-request is-question" aria-labelledby={uid + '-summary'}>
      <RequestSummary icon={<CircleHelp size={18} />} title={request.questions.length > 1 ? 'Questions from Codex' : 'A question from Codex'} titleId={uid + '-summary'}
        description={request.questions[0]?.question} status={pending ? 'Sending your answer…' : sent ? 'Answer sent · Checking request status' : !request.questions.length ? 'Request details unavailable' : request.isBlocking ? 'Codex is waiting for your answer' : 'Answer when you are ready'}
        action={sent ? 'View response' : answeredCount ? 'Continue' : 'Answer'} pending={pending} onOpen={() => { if (isCurrent(key)) setOpened(key); }} />
      {!open && failure && <RequestError message={failure} onRefresh={onRefresh ? () => void refresh() : undefined} refreshing={refreshing} />}
    </section>
    {open && <RequestDialog open onClose={close} title={request.questions.length > 1 ? 'Questions from Codex' : 'A question from Codex'} titleId={uid + '-dialog'}
      description={request.isBlocking ? 'Codex is waiting for your answer.' : 'You can answer while Codex continues.'} className="native-question-dialog">
      <form ref={form} onSubmit={event => void submit(event)} onKeyDown={event => {
        if (event.key === 'Enter' && (event.target instanceof HTMLInputElement)) event.preventDefault();
      }}>
        <div className="native-request-body">
          {request.questions.length > 1 && <div className="native-question-progress">
            <div><strong>Question {activeStep + 1} of {request.questions.length}</strong><span aria-live="polite">{sent ? request.questions.length + ' sent' : answeredCount + ' answered'}</span></div>
            <progress value={sent ? request.questions.length : answeredCount} max={request.questions.length} aria-label={sent ? 'Sent answers' : 'Answered questions'} />
            <ol className="native-question-steps" aria-label="Questions">{request.questions.map((question, index) => <li key={question.id}>
              <button type="button" onClick={() => goTo(index)} aria-current={index === activeStep ? 'step' : undefined}
                aria-label={'Question ' + (index + 1) + ': ' + question.header + (sent ? ', sent' : questionIsAnswered(question, current) ? ', answered' : ', unanswered')}>
                <span aria-hidden="true">{sent || questionIsAnswered(question, current) ? <Check size={13} /> : index + 1}</span>{question.header}
              </button>
            </li>)}</ol>
          </div>}
          {request.questions.map((question, index) => <fieldset className="native-question-field" data-question-step={index} key={question.id} hidden={activeStep !== index} disabled={disabled}>
            <legend tabIndex={-1}><span>{question.header}</span><strong>{question.question}</strong></legend>
            {question.isSecret ? <div className="native-question-secret">{sent ? <p><KeyRound size={15} aria-hidden="true" /> Secret answer sent.</p> : <label><span><KeyRound size={15} aria-hidden="true" />Your answer</span>
              <input type="password" data-private-input="true" className="input" name={'secret-' + question.id} aria-label={'Your answer for ' + question.header}
                autoComplete="off" spellCheck={false} maxLength={4000} onChange={event => update('secretPresent', question.id, !!event.target.value)} /></label>}
              <p>Secret input is cleared when this dialog closes or your answer is sent.</p>
            </div> : <>
              {!!question.options?.length && <div className="native-question-options">
                {question.options.map((option, optionIndex) => <label key={optionIndex} className={'native-question-option' + (current.choices[question.id] === optionIndex ? ' is-selected' : '')}>
                  <input type="radio" name={request.id + '-' + question.id} value={option.label} checked={current.choices[question.id] === optionIndex}
                    onChange={() => update('choices', question.id, optionIndex)} />
                  <span className="native-question-radio" aria-hidden="true">{current.choices[question.id] === optionIndex && <Check size={12} />}</span>
                  <span><strong>{option.label}</strong>{option.description && <small>{option.description}</small>}</span>
                </label>)}
                {question.isOther && <label className={'native-question-option' + (current.choices[question.id] === 'other' ? ' is-selected' : '')}>
                  <input type="radio" name={request.id + '-' + question.id} checked={current.choices[question.id] === 'other'} onChange={() => update('choices', question.id, 'other')} />
                  <span className="native-question-radio" aria-hidden="true">{current.choices[question.id] === 'other' && <Check size={12} />}</span><span><strong>Something else</strong><small>Write your own answer.</small></span>
                </label>}
              </div>}
              {(!question.options?.length || question.isOther && current.choices[question.id] === 'other') && <label className="native-question-text"><span>Your answer</span>
                <textarea className="input" aria-label={'Your answer for ' + question.header} rows={4} maxLength={4000} value={current.text[question.id] || ''}
                  onChange={event => update('text', question.id, event.target.value)} />
              </label>}
            </>}
          </fieldset>)}
          {!request.questions.length && <p role="status">This request has no available questions. Check its status to continue.</p>}
          {failure && <RequestError message={failure} onRefresh={onRefresh ? () => void refresh() : undefined} refreshing={refreshing} />}
          {sent && <p className="native-request-notice" role="status"><Check size={16} aria-hidden="true" />Your answer was sent. Waiting for Codex to update this request.</p>}
        </div>
        <div className="modal-footer native-request-footer">
          <button type="button" className="button ghost" onClick={activeStep > 0 && !sent ? () => goTo(activeStep - 1) : close}>{activeStep > 0 && !sent ? <><ArrowLeft size={14} aria-hidden="true" />Back</> : 'Close'}</button>
          {sent || !request.questions.length ? onRefresh && !failure && <button type="button" className="button" disabled={refreshing} onClick={() => void refresh()}><RefreshCw size={14} aria-hidden="true" />Check request</button>
            : activeStep < request.questions.length - 1 ? <button key="next-question" type="button" className="button primary" disabled={disabled || !questionIsAnswered(request.questions[activeStep], current)} onClick={event => { event.preventDefault(); goTo(activeStep + 1); }}>Next question<ArrowRight size={14} aria-hidden="true" /></button>
              : <button key="send-answers" type="submit" className="button primary" disabled={disabled || !answered}>{pending ? <LoaderCircle size={14} className="chat-spin" aria-hidden="true" /> : <ArrowUp size={14} aria-hidden="true" />}{failure ? 'Retry ' : 'Send '}{request.questions.length > 1 ? 'answers' : 'answer'}</button>}
        </div>
      </form>
    </RequestDialog>}
  </>;
}
