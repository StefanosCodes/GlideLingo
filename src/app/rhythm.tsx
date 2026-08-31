import { useRouter } from 'expo-router';

import { RhythmScreen } from '@/features/learning-progress/rhythm-screen';

export default function RhythmRoute() {
  const router = useRouter();

  function goBack() {
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/');
  }

  return <RhythmScreen onBack={goBack} />;
}
