"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LocationActionState } from "@/lib/locations/types";

const EMPTY: LocationActionState = { error: null, success: null };

/** Local feedback: persistent errors, four-second success and no work after unmount. */
export function useLocationFeedback() {
  const [state, setState] = useState<LocationActionState>(EMPTY);
  const mounted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; cancelTimer(); };
  }, [cancelTimer]);

  const clear = useCallback(() => {
    cancelTimer();
    if (mounted.current) setState(EMPTY);
  }, [cancelTimer]);
  const clearError = useCallback(() => {
    if (mounted.current) setState((current) => current.error ? EMPTY : current);
  }, []);
  const show = useCallback((result: LocationActionState) => {
    if (!mounted.current) return;
    cancelTimer();
    setState(result);
    if (result.success) {
      timer.current = setTimeout(() => {
        timer.current = null;
        if (mounted.current) setState(EMPTY);
      }, 4000);
    }
  }, [cancelTimer]);

  return { state, clear, clearError, show };
}
