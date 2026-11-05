import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { EMPTY_STATE, EngineState, ExecutionResult, STARTER_SCRIPT, executeScript } from './sqlEngine';

const STORAGE_KEY = '@sql-student-studio/state';
const SETTINGS_KEY = '@sql-student-studio/settings';

type Locale = 'ar' | 'en';

interface StudioContextValue {
  state: EngineState;
  script: string;
  setScript: (value: string) => void;
  result: ExecutionResult | null;
  execute: () => void;
  reset: () => void;
  locale: Locale;
  setLocale: (locale: Locale) => void;
  hydrated: boolean;
}

const StudioContext = createContext<StudioContextValue | null>(null);

export function StudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<EngineState>(EMPTY_STATE);
  const [script, setScript] = useState<string>(STARTER_SCRIPT);
  const [result, setResult] = useState<ExecutionResult | null>(null);
  const [locale, setLocaleState] = useState<Locale>('ar');
  const [hydrated, setHydrated] = useState(false);
  const settingsTouched = useRef(false);
  const persistenceQueue = useRef<Promise<void>>(Promise.resolve());

  const enqueuePersistence = (write: () => Promise<void>) => {
    persistenceQueue.current = persistenceQueue.current
      .catch(() => undefined)
      .then(write)
      .catch(() => undefined);
  };

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(SETTINGS_KEY)])
      .then(([savedState, savedSettings]) => {
        if (savedState) {
          try {
            const parsed = JSON.parse(savedState) as EngineState;
            if (parsed && typeof parsed === 'object' && parsed.databases) {
              setState(parsed);
            }
          } catch {
            setState(EMPTY_STATE);
          }
        }
        if (!settingsTouched.current && savedSettings === 'en') setLocaleState('en');
      })
      .catch(() => {
        setState(EMPTY_STATE);
      })
      .finally(() => {
        setHydrated(true);
      });
  }, []);

  const execute = () => {
    // Never replace saved workspace data with EMPTY_STATE while hydration is still in flight.
    if (!hydrated) return;
    const output = executeScript(state, script);
    setState(output.state);
    setResult(output.result);
    enqueuePersistence(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(output.state)));
  };

  const reset = () => {
    if (!hydrated) return;
    setState(EMPTY_STATE);
    setResult(null);
    setScript(STARTER_SCRIPT);
    // Queue deletion behind earlier writes so an old save cannot finish after the reset.
    enqueuePersistence(() => AsyncStorage.removeItem(STORAGE_KEY));
  };

  const setLocale = (nextLocale: Locale) => {
    settingsTouched.current = true;
    setLocaleState(nextLocale);
    enqueuePersistence(() => AsyncStorage.setItem(SETTINGS_KEY, nextLocale));
  };

  const value = useMemo(
    () => ({ state, script, setScript, result, execute, reset, locale, setLocale, hydrated }),
    [state, script, result, locale, hydrated]
  );

  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (!context) throw new Error('useStudio must be used inside StudioProvider');
  return context;
}
