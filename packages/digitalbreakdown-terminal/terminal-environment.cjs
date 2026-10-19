function terminalEnvironment(env = process.env) {
  const inherited = env.TERM;
  // node-pty is configured as xterm-256color. Only repair the known non-terminal
  // parent value; preserve an explicit compatible terminal choice.
  const term = env.DB_TERMINAL_TERM || (!inherited || inherited === "dumb" ? "xterm-256color" : inherited);
  return { ...env, TERM: term };
}

module.exports = { terminalEnvironment };
