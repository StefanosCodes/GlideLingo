import { useEffect } from 'react';
import { Platform } from 'react-native';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';

import { LessonLectureView } from '@/features/learning-session/lesson-lecture-view';
import { useLearning } from '@/providers/learning-provider';

export default function LessonScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { openLesson } = useLearning();

  useEffect(() => {
    if (id && Platform.OS === 'web') {
      openLesson(id);
    }
  }, [id, openLesson]);

  if (Platform.OS === 'web') {
    return <Redirect href="/" />;
  }

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }

  return <LessonLectureView key={id} lessonId={id ?? ''} onClose={goBack} />;
}
