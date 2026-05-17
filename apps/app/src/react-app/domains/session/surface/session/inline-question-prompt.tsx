/** @jsxImportSource react */
import { useEffect, useState } from "react";
import type { QuestionInfo } from "@aiwork-engine/sdk/v2/client";
import { dlsPrimarySolidClass } from "../../../workspace/modal-styles";

export function InlineQuestionPrompt(props: {
  active: { id: string; questions: QuestionInfo[] };
  busy: boolean;
  onReply: (answers: string[][]) => void;
  onDismiss?: () => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[][]>([]);
  const [currentSelection, setCurrentSelection] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");

  useEffect(() => {
    setCurrentIndex(0);
    setAnswers(new Array(props.active.questions.length).fill([]));
    setCurrentSelection([]);
    setCustomInput("");
  }, [props.active.id, props.active.questions.length]);

  const currentQuestion = props.active.questions[currentIndex];
  if (!currentQuestion) return null;

  const isLastQuestion = currentIndex === props.active.questions.length - 1;
  const canProceed = (() => {
    if (currentQuestion.custom && customInput.trim().length > 0) return true;
    return currentSelection.length > 0;
  })();

  const toggleOption = (value: string) => {
    if (props.busy) return;
    if (currentQuestion.multiple) {
      setCurrentSelection((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));
      return;
    }
    setCurrentSelection([value]);
    if (!currentQuestion.custom) {
      const nextAnswers = answers.slice();
      nextAnswers[currentIndex] = [value];
      if (isLastQuestion) {
        props.onReply(nextAnswers);
      } else {
        setAnswers(nextAnswers);
        setCurrentIndex((i) => i + 1);
        setCurrentSelection([]);
        setCustomInput("");
      }
    }
  };

  const handleNext = () => {
    if (!canProceed || props.busy) return;
    const nextAnswer = [...currentSelection];
    if (currentQuestion.custom && customInput.trim()) {
      nextAnswer.push(customInput.trim());
    }
    const nextAnswers = answers.slice();
    nextAnswers[currentIndex] = nextAnswer;
    if (isLastQuestion) {
      props.onReply(nextAnswers);
    } else {
      setAnswers(nextAnswers);
      setCurrentIndex((i) => i + 1);
      setCurrentSelection([]);
      setCustomInput("");
    }
  };

  return (
    <div className="mx-auto w-full max-w-[800px] px-3 sm:px-5">
      <div className="mb-3 rounded-2xl border border-dls-border bg-dls-surface shadow-[var(--dls-card-shadow)]">
        <div className="flex items-start justify-between gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <div className="text-[13px] font-semibold text-dls-text">
                {currentQuestion.header || "Question"}
              </div>
              <div className="text-[11px] font-medium text-dls-secondary">
                {currentIndex + 1} / {props.active.questions.length}
              </div>
            </div>
            <div className="mt-1 text-[13px] leading-5 text-dls-secondary">
              {currentQuestion.question}
            </div>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full px-2 py-1 text-[12px] font-medium text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text disabled:opacity-60"
            onClick={props.onDismiss}
            disabled={props.busy}
            aria-label="Dismiss question"
            title="Dismiss"
          >
            ×
          </button>
        </div>

        <div className="px-4 pb-4 sm:px-5">
          <div className="flex flex-col gap-2">
            {currentQuestion.options.map((opt: { description: string; label?: string }) => {
              const value = opt.description;
              const selected = currentSelection.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  className={`flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition-colors ${
                    selected
                      ? "border-[rgba(var(--dls-accent-rgb),0.35)] bg-[rgba(var(--dls-accent-rgb),0.10)] text-dls-text"
                      : "border-dls-border bg-dls-surface text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                  }`}
                  onClick={() => toggleOption(value)}
                  disabled={props.busy}
                >
                  <span className="min-w-0 break-words font-medium text-current">{opt.label || value}</span>
                  <span
                    className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      selected
                        ? "border-[rgba(var(--dls-accent-rgb),0.45)] bg-[rgba(var(--dls-accent-rgb),0.25)]"
                        : "border-dls-border bg-transparent"
                    }`}
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>

          {currentQuestion.custom ? (
            <div className="mt-3">
              <input
                type="text"
                value={customInput}
                onChange={(event) => setCustomInput(event.currentTarget.value)}
                className="w-full rounded-xl border border-dls-border bg-dls-surface px-3.5 py-2.5 text-[13px] text-dls-text placeholder:text-dls-secondary focus:border-[rgba(var(--dls-accent-rgb),0.45)] focus:outline-none"
                placeholder="Type your answer…"
                disabled={props.busy}
              />
            </div>
          ) : null}

          {currentQuestion.multiple || currentQuestion.custom ? (
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                className={`inline-flex items-center justify-center rounded-full px-4 py-2 text-[12px] font-semibold transition-colors disabled:opacity-60 ${dlsPrimarySolidClass}`}
                onClick={handleNext}
                disabled={!canProceed || props.busy}
              >
                {isLastQuestion ? "Submit" : "Next"}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
