/**
 * Application State Provider for Console Plugin
 *
 * Lightweight state management compatible with frontend's useApp() hook.
 * Provides state and updateState to child components.
 */
import * as React from 'react';

interface AppState {
  [key: string]: any;
}

interface AppContextValue {
  state: AppState;
  updateState: (patch: Partial<AppState>) => void;
}

const AppContext = React.createContext<AppContextValue | undefined>(undefined);

interface AppProviderProps {
  children: React.ReactNode;
}

export const AppProvider: React.FC<AppProviderProps> = ({ children }) => {
  const [state, setState] = React.useState<AppState>({
    // Initialize with empty state - components will populate as needed
    release: {},
    version: {},
    operators: {},
    imagesetConfig: {},
    ui: {}
  });

  const updateState = React.useCallback((patch: Partial<AppState>) => {
    setState((prev) => ({
      ...prev,
      ...patch
    }));
  }, []);

  const value = React.useMemo(
    () => ({ state, updateState }),
    [state, updateState]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

export const useApp = (): AppContextValue => {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
};
