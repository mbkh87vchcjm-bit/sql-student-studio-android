import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
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
        if (savedSettings === 'en') setLocaleState('en');
      })
      .catch(() => {
        setState(EMPTY_STATE);
      })
      .finally(() => {
        setHydrated(true);
      });
  }, []);

  const execute = () => {
    const output = executeScript(state, script);
    setState(output.state);
    setResult(output.result);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(output.state)).catch(() => {});
  };

  const reset = () => {
    setState(EMPTY_STATE);
    setResult(null);
    setScript(STARTER_SCRIPT);
    void AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
  };

  const setLocale = (nextLocale: Locale) => {
    setLocaleState(nextLocale);
    void AsyncStorage.setItem(SETTINGS_KEY, nextLocale).catch(() => {});
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
