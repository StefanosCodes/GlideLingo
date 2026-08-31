import { Redirect } from 'expo-router';

export default function NativeSsoCallbackRoute() {
  return <Redirect href="/sign-in" />;
}
