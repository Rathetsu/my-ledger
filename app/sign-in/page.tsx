import { SignInForm } from '@/components/sign-in-form'
import { redirectIfAuthenticated } from '@/lib/auth'

export default async function SignInPage() {
  await redirectIfAuthenticated() // already signed in -> go to the app
  return <SignInForm />
}
