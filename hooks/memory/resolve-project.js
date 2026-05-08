export function resolveProject(cwd) {
  if (!cwd) cwd = process.cwd();
  cwd = cwd.replace(/\/$/, '') || '/';
  return cwd.replace(/\//g, '-');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(resolveProject(process.argv[2]));
}
