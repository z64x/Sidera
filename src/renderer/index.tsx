import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';

const originalConsoleError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  const firstArg = args[0];
  if (
    typeof firstArg === 'string' &&
    firstArg.includes("Warning: [antd: Image] `rootClassName` is deprecated") &&
    firstArg.includes('Please use `classNames.root` instead')
  ) {
    return;
  }

  originalConsoleError(...args);
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
