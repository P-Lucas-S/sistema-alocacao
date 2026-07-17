import React, { createContext, useContext, useState } from 'react';

interface GestorFiltroContextType {
  gestorIdFiltro: string | undefined;
  setGestorIdFiltro: (id: string | undefined) => void;
}

const GestorFiltroContext = createContext<GestorFiltroContextType | undefined>(undefined);

export const GestorFiltroProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [gestorIdFiltro, setGestorIdFiltro] = useState<string | undefined>(undefined);
  return (
    <GestorFiltroContext.Provider value={{ gestorIdFiltro, setGestorIdFiltro }}>
      {children}
    </GestorFiltroContext.Provider>
  );
};

export const useGestorFiltro = () => {
  const ctx = useContext(GestorFiltroContext);
  if (!ctx) throw new Error('useGestorFiltro must be used within GestorFiltroProvider');
  return ctx;
};
