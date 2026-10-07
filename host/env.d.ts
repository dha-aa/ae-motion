// Ambient declarations for the host scripts (types only; nothing is emitted).

/** TypeScript utility type the After Effects declarations use; noLib leaves it out. */
type Extract<T, U> = T extends U ? T : never;

/** The command table, created by the wrapper in scripts/build-host.ts: C.<name>(args) for every bridged tool. */
declare var C: { [command: string]: (a: any) => any };
