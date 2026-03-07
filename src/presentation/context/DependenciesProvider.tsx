// 1. Importamos solo los valores (funciones) de React en esta línea
import React, { createContext, useContext } from "react";

// 2. Importamos explícitamente el tipo ReactNode en su propia línea
import type { ReactNode } from "react";

// 3. Importamos el valor y marcamos explícitamente la interfaz con "type" adentro de las llaves
import {
  dependencies,
  type Dependencies,
} from "../../infrastructure/dependencies";

const DependenciesContext = createContext<Dependencies | null>(null);

interface Props {
  children: ReactNode;
}

export const DependenciesProvider: React.FC<Props> = ({ children }) => {
  return (
    <DependenciesContext.Provider value={dependencies}>
      {children}
    </DependenciesContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useDependencies = (): Dependencies => {
  const context = useContext(DependenciesContext);
  if (!context) {
    throw new Error(
      "useDependencies debe usarse dentro de un DependenciesProvider",
    );
  }
  return context;
};
