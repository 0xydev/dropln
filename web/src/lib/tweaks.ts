import * as React from "react";

// useTweaks — single-source-of-truth for the design panel's state.
// In the original prototype it also posted to a parent editmode host;
// in this port the postMessage path is dropped — we only need the
// state machinery here.
export function useTweaks<T extends Record<string, unknown>>(defaults: T) {
  const [values, setValues] = React.useState<T>(defaults);

  const setTweak = React.useCallback(
    (keyOrEdits: keyof T | Partial<T>, val?: T[keyof T]) => {
      const edits =
        typeof keyOrEdits === "object" && keyOrEdits !== null
          ? (keyOrEdits as Partial<T>)
          : ({ [keyOrEdits as keyof T]: val } as Partial<T>);
      setValues((prev) => ({ ...prev, ...edits }));
    },
    [],
  );

  return [values, setTweak] as const;
}
