export type CourseSchemaError = {
  instancePath: string;
  keyword: string;
  message?: string;
  params: Record<string, unknown>;
};

export type CourseSchemaValidator = {
  (value: unknown): boolean;
  errors?: CourseSchemaError[] | null;
};

export const course: CourseSchemaValidator;
export const languageProfile: CourseSchemaValidator;
export const capabilities: CourseSchemaValidator;
export const modules: CourseSchemaValidator;
export const mission: CourseSchemaValidator;
export const scenario: CourseSchemaValidator;
export const pronunciationTargets: CourseSchemaValidator;
export const publication: CourseSchemaValidator;
export const audioManifest: CourseSchemaValidator;
