#!/usr/bin/env node
// The old script wrote password hashes into frontend assets. Do not restore that flow.
// This checkout has no server-side auth or database adapter to provision securely.
console.error("Administrator setup requires a trusted server and database connection. No credentials or account records were written.");
process.exitCode = 1;
