// Static package registry for Metro, web, and Electron. Future authoring tooling may
// generate this file, but universal loader code never imports an individual lesson.
import audioManifest from '../../../../content/courses/en-el-GR/audio-manifest.json';
import capabilities from '../../../../content/courses/en-el-GR/capabilities.json';
import compatibilityPresentation from '../../../../content/courses/en-el-GR/compatibility/el-letters-1.presentation.json';
import course from '../../../../content/courses/en-el-GR/course.json';
import languageProfile from '../../../../content/courses/en-el-GR/language-profile.json';
import mission from '../../../../content/courses/en-el-GR/missions/el-letters-sound-map.json';
import modules from '../../../../content/courses/en-el-GR/modules.json';
import pronunciationTargets from '../../../../content/courses/en-el-GR/pronunciation/targets.json';
import publication from '../../../../content/courses/en-el-GR/publication.json';

import type { CoursePackageSource } from '@/features/course-catalog/model/course-content';

export const enElGrPackageSource: CoursePackageSource = {
  course,
  languageProfile,
  capabilities,
  modules,
  missions: [mission],
  scenarios: [],
  pronunciationTargets,
  publication,
  audioManifest,
};

export const enElGrCompatibilityPresentation = compatibilityPresentation;
