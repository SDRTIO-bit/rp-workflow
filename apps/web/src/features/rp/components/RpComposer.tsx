import type { FormEvent, KeyboardEvent } from "react";

type RpComposerProps = {
  value: string;
  disabled: boolean;
  canRetry: boolean;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onContinue: () => void;
  onRetry: () => void;
  onCancel: () => void;
};

export const RpComposer = ({
  value,
  disabled,
  canRetry,
  onChange,
  onSubmit,
  onContinue,
  onRetry,
  onCancel,
}: RpComposerProps) => {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit(value);
    }
  };

  return (
    <form className="rp-composer" onSubmit={submit}>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="输入玩家行动。Enter 发送，Shift+Enter 换行。"
      />
      <div className="composer-actions">
        <button type="submit" className="primary" disabled={disabled || !value.trim()}>
          Send
        </button>
        <button type="button" disabled={disabled} onClick={onContinue}>
          Continue
        </button>
        <button type="button" disabled={disabled || !canRetry} onClick={onRetry}>
          Retry
        </button>
        <button type="button" disabled={!disabled} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
};
