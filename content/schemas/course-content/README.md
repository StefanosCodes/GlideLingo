# Course content schemas

`v1/` contains the universal JSON Schemas for the logical records in section 6 of
`docs/learning/COURSE-SKELETON-IMPLEMENTATION.md`. The schemas describe authored course data; they do not move learning,
assessment, publication, or unlock authority into a model or provider.

Run the deterministic repository validator with:

```bash
npm run course:validate
```

The default command validates schema-based packages under `content/courses/` and the valid portability fixture. Course
directories without `course.json` remain on the explicit legacy bridge and are reported without being migrated. Pass
one or more package directories after `--` to validate only those paths.

Intentional invalid cases under `content/fixtures/course-content/invalid/` are small mutation fixtures applied to the
valid fictional package by `npm run test:course`. They cover duplicate IDs, missing references, prerequisite cycles,
assessment leakage, missing assets, and unsupported renderer types without duplicating a full package.
