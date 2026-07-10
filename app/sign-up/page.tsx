import { SignUpForm } from '@/components/sign-up-form'
import { redirectIfAuthenticated } from '@/lib/auth'

export default async function SignUpPage() {
  await redirectIfAuthenticated() // already signed in -> go to the app
  return <SignUpForm />
}
