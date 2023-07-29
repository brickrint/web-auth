import { conform, useForm } from '@conform-to/react'
import { getFieldsetConstraint, parse } from '@conform-to/zod'
import {
	json,
	redirect,
	type DataFunctionArgs,
	type V2_MetaFunction,
} from '@remix-run/node'
import { Form, useActionData, useSearchParams } from '@remix-run/react'
import { safeRedirect } from 'remix-utils'
import { z } from 'zod'
import { CheckboxField, ErrorList, Field } from '~/components/forms.tsx'
import { Spacer } from '~/components/spacer.tsx'
import { StatusButton } from '~/components/ui/status-button.tsx'
import {
	SESSION_EXPIRATION_TIME,
	requireAnonymous,
	signup,
	userIdKey,
} from '~/utils/auth.server.ts'
import { prisma } from '~/utils/db.server.ts'
import { useIsSubmitting } from '~/utils/misc.tsx'
import { commitSession, getSession } from '~/utils/session.server.ts'
import {
	emailSchema,
	nameSchema,
	passwordSchema,
	usernameSchema,
} from '~/utils/user-validation.ts'
import { checkboxSchema } from '~/utils/zod-extensions.ts'

const SignupFormSchema = z
	.object({
		username: usernameSchema,
		name: nameSchema,
		email: emailSchema,
		password: passwordSchema,
		confirmPassword: passwordSchema,
		agreeToTermsOfServiceAndPrivacyPolicy: checkboxSchema(
			'You must agree to the terms of service and privacy policy',
		),
		remember: checkboxSchema(),
		redirectTo: z.string().optional(),
	})
	.superRefine(({ confirmPassword, password }, ctx) => {
		if (confirmPassword !== password) {
			ctx.addIssue({
				path: ['confirmPassword'],
				code: 'custom',
				message: 'The passwords must match',
			})
		}
	})

export async function loader({ request }: DataFunctionArgs) {
	await requireAnonymous(request)
	return json({})
}

export async function action({ request }: DataFunctionArgs) {
	await requireAnonymous(request)
	const formData = await request.formData()
	const submission = await parse(formData, {
		schema: SignupFormSchema.superRefine(async (data, ctx) => {
			const existingUser = await prisma.user.findUnique({
				where: { username: data.username },
				select: { id: true },
			})
			if (existingUser) {
				ctx.addIssue({
					path: ['username'],
					code: z.ZodIssueCode.custom,
					message: 'A user already exists with this username',
				})
				return
			}
		}).transform(async data => {
			const user = await signup(data)
			return { ...data, user }
		}),
		async: true,
	})

	if (submission.intent !== 'submit') {
		return json({ status: 'idle', submission } as const)
	}
	if (!submission.value) {
		return json({ status: 'error', submission } as const, { status: 400 })
	}

	const { user, remember, redirectTo } = submission.value

	const cookieSession = await getSession(request.headers.get('cookie'))
	cookieSession.set(userIdKey, user.id)

	return redirect(safeRedirect(redirectTo), {
		headers: {
			'set-cookie': await commitSession(cookieSession, {
				// Cookies with no expiration are cleared when the tab/window closes
				expires: remember
					? new Date(Date.now() + SESSION_EXPIRATION_TIME)
					: undefined,
			}),
		},
	})
}

export const meta: V2_MetaFunction = () => {
	return [{ title: 'Setup Epic Notes Account' }]
}

export default function SignupRoute() {
	const [searchParams] = useSearchParams()
	const actionData = useActionData<typeof action>()
	const isSubmitting = useIsSubmitting()

	const [form, fields] = useForm({
		id: 'signup',
		constraint: getFieldsetConstraint(SignupFormSchema),
		defaultValue: { redirectTo: searchParams.get('redirectTo') },
		lastSubmission: actionData?.submission,
		onValidate({ formData }) {
			return parse(formData, { schema: SignupFormSchema })
		},
		shouldRevalidate: 'onBlur',
	})

	return (
		<div className="container flex min-h-full flex-col justify-center pb-32 pt-20">
			<div className="mx-auto w-full max-w-lg">
				<div className="flex flex-col gap-3 text-center">
					<h1 className="text-h1">Welcome aboard!</h1>
					<p className="text-body-md text-muted-foreground">
						Please enter your details.
					</p>
				</div>
				<Spacer size="xs" />
				<Form
					method="POST"
					className="mx-auto min-w-[368px] max-w-sm"
					{...form.props}
				>
					<Field
						labelProps={{ htmlFor: fields.email.id, children: 'Email' }}
						inputProps={{
							...conform.input(fields.email),
							autoComplete: 'email',
							autoFocus: true,
							className: 'lowercase',
						}}
						errors={fields.email.errors}
					/>
					<Field
						labelProps={{ htmlFor: fields.username.id, children: 'Username' }}
						inputProps={{
							...conform.input(fields.username),
							autoComplete: 'username',
							className: 'lowercase',
						}}
						errors={fields.username.errors}
					/>
					<Field
						labelProps={{ htmlFor: fields.name.id, children: 'Name' }}
						inputProps={{
							...conform.input(fields.name),
							autoComplete: 'name',
						}}
						errors={fields.name.errors}
					/>
					<Field
						labelProps={{ htmlFor: fields.password.id, children: 'Password' }}
						inputProps={{
							...conform.input(fields.password, { type: 'password' }),
							autoComplete: 'new-password',
						}}
						errors={fields.password.errors}
					/>

					<Field
						labelProps={{
							htmlFor: fields.confirmPassword.id,
							children: 'Confirm Password',
						}}
						inputProps={{
							...conform.input(fields.confirmPassword, { type: 'password' }),
							autoComplete: 'new-password',
						}}
						errors={fields.confirmPassword.errors}
					/>

					<CheckboxField
						labelProps={{
							htmlFor: fields.agreeToTermsOfServiceAndPrivacyPolicy.id,
							children:
								'Do you agree to our Terms of Service and Privacy Policy?',
						}}
						buttonProps={conform.input(
							fields.agreeToTermsOfServiceAndPrivacyPolicy,
							{ type: 'checkbox' },
						)}
						errors={fields.agreeToTermsOfServiceAndPrivacyPolicy.errors}
					/>
					<CheckboxField
						labelProps={{
							htmlFor: fields.remember.id,
							children: 'Remember me',
						}}
						buttonProps={conform.input(fields.remember, { type: 'checkbox' })}
						errors={fields.remember.errors}
					/>

					<input {...conform.input(fields.redirectTo)} type="hidden" />
					<ErrorList errors={form.errors} id={form.errorId} />

					<div className="flex items-center justify-between gap-6">
						<StatusButton
							className="w-full"
							status={isSubmitting ? 'pending' : actionData?.status ?? 'idle'}
							type="submit"
							disabled={isSubmitting}
						>
							Create an account
						</StatusButton>
					</div>
				</Form>
			</div>
		</div>
	)
}