// The production entry point always serves the built React client.
process.env.NODE_ENV ??= 'production';
await import('./index.js');
