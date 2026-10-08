import { MIGRATION_FILENAMES } from "../../packages/database/src/migrations/catalog";

if (process.argv[2] !== "--format=filenames") {
  console.error("catalog=status=invalid-arguments");
  process.exitCode = 2;
} else {
  for (const filename of MIGRATION_FILENAMES) console.log(filename);
}
