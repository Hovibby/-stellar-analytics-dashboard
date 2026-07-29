/**
 * App root (issue #49)
 *
 * Wraps the application in ApolloProvider so every component can use
 * Apollo hooks (useQuery, useMutation, useSubscription).
 * Wraps the application in ThemeProvider for dark mode support.
 */
import { useState, useEffect } from 'react';
import { ApolloProvider } from "@apollo/client";
import { apolloClient } from "./graphql/client";
import { DashboardPage } from "./pages/DashboardPage";
import { ThemeProvider } from "./contexts/ThemeContext";
import { SchemaFallback } from "./components/SchemaFallback";

export function App() {
  const [schemaError, setSchemaError] = useState<{ message: string; details?: string } | null>(null);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('graphql-schema-error');
      if (raw) {
        setSchemaError(JSON.parse(raw));
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  const handleDismiss = () => {
    sessionStorage.removeItem('graphql-schema-error');
    setSchemaError(null);
  };

  if (schemaError) {
    return <SchemaFallback error={schemaError} onDismiss={handleDismiss} />;
  }

  return (
    <ThemeProvider>
      <ApolloProvider client={apolloClient}>
        <DashboardPage />
      </ApolloProvider>
    </ThemeProvider>
  );
}
