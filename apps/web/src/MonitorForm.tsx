import { Field as ArkField } from '@ark-ui/react/field'
import { zodResolver } from '@hookform/resolvers/zod'
import { BROWSER_MIN_INTERVAL_MINUTES, evaluatorSchema, type MonitorConfig, monitorConfigSchema } from '@mirowler/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link as RouterLink, useNavigate, useParams } from '@tanstack/react-router'
import { parseResponse } from 'hono/client'
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react'
import {
  Controller,
  type FieldPath,
  FormProvider,
  get,
  type Resolver,
  type UseFormSetError,
  useForm,
  useFormContext,
  useFormState,
  useWatch,
} from 'react-hook-form'
import { css } from 'styled-system/css'
import { Grid, HStack, Stack, styled } from 'styled-system/jsx'
import { input } from 'styled-system/recipes'
import { client, errorBody, httpStatus } from '~/api'
import { fetchChannels } from '~/Channels'
import { Badge, Button, Checkbox, Field, Heading, Input, Link } from '~/components/ui'
import { formatValue } from '~/format'
import { fetchMonitor } from '~/MonitorDetail'
import {
  defaultValues,
  type FormValues,
  fieldForIssue,
  fromConfig,
  opsFor,
  toConfig,
  toEvaluator,
  toExtractor,
  toSource,
  valueKind,
} from './monitorFormValues'

const StyledSelect = styled(ArkField.Select, input)
const Select = (props: ComponentProps<typeof StyledSelect>) => <StyledSelect appearance="auto" {...props} />

const timeZones = Intl.supportedValuesOf?.('timeZone') ?? []

const labels = {
  source: { http: 'Fetch the HTML', browser: 'Render in a browser' },
  schedule: { interval: 'Every few minutes', daily: 'Once a day' },
  extractor: { css_text: 'Text of an element', css_attr: 'Attribute of an element' },
  parse: { text: 'Text', jpy: 'Price in yen' },
  evaluator: { rule: 'Matches a rule', change: 'Changed since the last value' },
  op: {
    contains: 'Contains',
    not_contains: 'Does not contain',
    lt: 'Is less than',
    lte: 'Is at most',
    changed: 'Changed',
    decreased: 'Decreased',
    decreased_by_percent: 'Decreased by at least',
  },
  trigger: { on_enter: 'When it starts matching', on_value_change: 'When the value changes while matching' },
  value: { text: 'Text', amount: 'Amount (yen)', percent: 'Percent' },
  state: { matched: 'Condition matches', not_matched: 'Condition does not match' },
}

const leafPaths = (value: object, prefix = ''): string[] =>
  Object.entries(value).flatMap(([key, v]) =>
    v && typeof v === 'object' && !Array.isArray(v) ? leafPaths(v, `${prefix}${key}.`) : [`${prefix}${key}`],
  )

const fieldPaths = new Set(leafPaths(defaultValues))

const schemaResolver = zodResolver(monitorConfigSchema)

// toConfig only shapes the input; the schema decides whether it is a valid config, so its output is checked at runtime
const resolver = ((values, context, options) =>
  schemaResolver(toConfig(values) as MonitorConfig, context, options as never)) as Resolver<
  FormValues,
  unknown,
  MonitorConfig
>

const jsonBody = (body: unknown) => ({
  headers: { 'content-type': 'application/json' },
  init: { body: JSON.stringify(body) },
})

const issuesOf = (error: unknown) =>
  error instanceof Error && httpStatus(error) === 400 ? errorBody(error)?.issues : undefined

const showIssues = (setError: UseFormSetError<FormValues>, issues: { path: string; message: string }[]) => {
  const unplaced: string[] = []
  for (const { path, message } of issues) {
    const field = fieldForIssue(path)
    if (fieldPaths.has(field)) {
      setError(field as FieldPath<FormValues>, { type: 'server', message })
    } else {
      unplaced.push(`${path || 'config'}: ${message}`)
    }
  }
  return unplaced.join('; ')
}

const options = <K extends string>(names: Record<K, string>, keys = Object.keys(names) as K[]) =>
  keys.map((key) => (
    <option key={key} value={key}>
      {names[key]}
    </option>
  ))

const FormField = ({
  name,
  label,
  hint,
  children,
}: {
  name: FieldPath<FormValues>
  label: string
  hint?: string
  children: ReactNode
}) => {
  const { errors } = useFormState<FormValues>({ name })
  const message: string | undefined = get(errors, name)?.message
  return (
    <Field.Root invalid={message !== undefined}>
      <Field.Label>{label}</Field.Label>
      {children}
      {hint && <Field.HelperText>{hint}</Field.HelperText>}
      <Field.ErrorText>{message}</Field.ErrorText>
    </Field.Root>
  )
}

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <Stack as="section" gap="4" borderTopWidth="1px" pt="6">
    <Heading as="h2" textStyle="lg">
      {title}
    </Heading>
    {children}
  </Stack>
)

const ScheduleFields = () => {
  const { register, control } = useFormContext<FormValues>()
  const type = useWatch({ control, name: 'schedule.type' })
  return (
    <Section title="Schedule">
      <FormField name="schedule.type" label="Runs">
        <Select {...register('schedule.type')}>{options(labels.schedule)}</Select>
      </FormField>
      {type === 'interval' ? (
        <FormField name="schedule.minutes" label="Every (minutes)">
          <Input type="number" min={1} {...register('schedule.minutes')} />
        </FormField>
      ) : (
        <HStack gap="4" alignItems="start">
          <FormField name="schedule.time" label="Time">
            <Input type="time" {...register('schedule.time')} />
          </FormField>
          <FormField name="schedule.timezone" label="Time zone">
            <Input list="time-zones" {...register('schedule.timezone')} />
            <datalist id="time-zones">
              {timeZones.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </FormField>
        </HStack>
      )}
    </Section>
  )
}

const ExtractionFields = () => {
  const { register, control } = useFormContext<FormValues>()
  const [sourceType, type, selector] = useWatch({
    control,
    name: ['source.type', 'extractor.type', 'extractor.selector'],
  })
  return (
    <Stack gap="4">
      <FormField
        name="source.type"
        label="Fetch"
        hint={
          sourceType === 'browser'
            ? `For pages that load their content with scripts; each run uses browser time, so runs are at least ${BROWSER_MIN_INTERVAL_MINUTES} minutes apart`
            : undefined
        }
      >
        <Select {...register('source.type')}>{options(labels.source)}</Select>
      </FormField>
      <FormField name="source.url" label="Page URL">
        <Input type="url" placeholder="https://" {...register('source.url')} />
      </FormField>
      {sourceType === 'browser' && (
        <FormField
          name="source.waitForSelector"
          label="Wait for CSS selector"
          hint="The page is read once this element appears; for a stock marker, pick an element that appears either way. Empty uses the CSS selector below"
        >
          <Input placeholder={selector} {...register('source.waitForSelector')} />
        </FormField>
      )}
      <FormField name="extractor.type" label="Read">
        <Select {...register('extractor.type')}>{options(labels.extractor)}</Select>
      </FormField>
      <FormField name="extractor.selector" label="CSS selector">
        <Input {...register('extractor.selector')} />
      </FormField>
      {type === 'css_attr' && (
        <FormField name="extractor.attribute" label="Attribute name">
          <Input {...register('extractor.attribute')} />
        </FormField>
      )}
      <FormField name="extractor.parse" label="Read the value as">
        <Select {...register('extractor.parse')}>{options(labels.parse)}</Select>
      </FormField>
    </Stack>
  )
}

const PreviewPanel = () => {
  const { getValues, setError, trigger, watch, getFieldState } = useFormContext<FormValues>()
  const preview = useMutation({
    mutationFn: async () => {
      if (!(await trigger(['source.url', 'source.waitForSelector', 'extractor.selector', 'extractor.attribute']))) {
        return null
      }
      const values = getValues()
      const evaluator = evaluatorSchema.safeParse(toEvaluator(values)).data
      const input = { source: toSource(values), extractor: toExtractor(values), evaluator }
      try {
        const result = await parseResponse(client.api.preview.$post({}, jsonBody(input)))
        return { ...result, evaluatorType: evaluator?.type }
      } catch (e) {
        const issues = issuesOf(e)
        if (!issues) {
          throw e
        }
        if (JSON.stringify(values) !== JSON.stringify(getValues())) {
          return null
        }
        const unplaced = showIssues(setError, issues)
        if (unplaced) {
          throw new Error(unplaced)
        }
        return null
      }
    },
  })
  const { reset } = preview
  useEffect(() => {
    const subscription = watch((_, { name }) => {
      if (!name) {
        return
      }
      if (getFieldState(name).error) {
        void trigger(name)
      }
      if (name === 'source.type' && getFieldState('schedule.minutes').error) {
        void trigger('schedule.minutes')
      }
      if (/^(source|extractor|evaluator)\./.test(name)) {
        reset()
      }
    })
    return () => subscription.unsubscribe()
  }, [watch, reset, getFieldState, trigger])
  const result = preview.data
  const state = result && 'state' in result ? result.state : undefined
  return (
    <Stack gap="3" p="4" borderWidth="1px" borderRadius="l3" alignSelf="start">
      <HStack justify="space-between">
        <strong>Preview</strong>
        <Button size="sm" variant="outline" loading={preview.isPending} onClick={() => preview.mutate()}>
          Fetch now
        </Button>
      </HStack>
      {preview.error && (
        <p role="alert" className={css({ color: 'error' })}>
          {preview.error.message}
        </p>
      )}
      {!result ? (
        <p className={css({ color: 'fg.muted' })}>Fetch the page with the current input before saving</p>
      ) : (
        <Stack gap="2" aria-live="polite">
          <p>
            Value: <strong>{formatValue(result.value)}</strong>
          </p>
          {result.httpStatus !== undefined && <p>HTTP status {result.httpStatus}</p>}
          {state === 'unknown' ? (
            <p role="alert" className={css({ color: 'error' })}>
              No usable value: {result.reason}
            </p>
          ) : state ? (
            <Badge colorPalette={state === 'matched' ? 'green' : 'gray'}>{labels.state[state]}</Badge>
          ) : (
            <p className={css({ color: 'fg.muted' })}>
              {result.evaluatorType === 'change'
                ? 'A change is judged against the previous value once the monitor runs'
                : 'Complete the condition to check it against this value'}
            </p>
          )}
        </Stack>
      )}
    </Stack>
  )
}

const ConditionFields = () => {
  const { register, control, setValue } = useFormContext<FormValues>()
  const [type, parse, op] = useWatch({ control, name: ['evaluator.type', 'extractor.parse', 'evaluator.op'] })
  const ops = opsFor(type, parse)
  const kind = valueKind(type, op)
  const last = useRef({ type, parse, kind })
  useEffect(() => {
    const prev = last.current
    last.current = { type, parse, kind }
    if ((prev.type !== type || prev.parse !== parse) && !ops.includes(op)) {
      setValue('evaluator.op', ops[0])
    } else if (prev.kind !== kind) {
      setValue('evaluator.value', '')
    }
  }, [type, parse, kind, op, ops, setValue])
  return (
    <Section title="Condition">
      <FormField name="evaluator.type" label="Notify when the value">
        <Select {...register('evaluator.type')}>{options(labels.evaluator)}</Select>
      </FormField>
      <HStack gap="4" alignItems="start">
        <FormField name="evaluator.op" label="Operator">
          <Select {...register('evaluator.op')}>{options(labels.op, ops.includes(op) ? ops : [...ops, op])}</Select>
        </FormField>
        {kind && (
          <FormField name="evaluator.value" label={labels.value[kind]}>
            <Input type={kind === 'text' ? 'text' : 'number'} {...register('evaluator.value')} />
          </FormField>
        )}
      </HStack>
      {type === 'rule' ? (
        <FormField name="trigger.type" label="Notify">
          <Select {...register('trigger.type')}>{options(labels.trigger)}</Select>
        </FormField>
      ) : (
        <p className={css({ color: 'fg.muted' })}>Every qualifying change notifies</p>
      )}
    </Section>
  )
}

const ChannelFields = () => {
  const { control } = useFormContext<FormValues>()
  const { errors } = useFormState<FormValues>({ name: 'channelIds' })
  const { data, error } = useQuery({ queryKey: ['channels'], queryFn: fetchChannels })
  return (
    <Section title="Notify">
      {error ? (
        <p role="alert">{error.message}</p>
      ) : !data ? (
        <p>Loading…</p>
      ) : data.length === 0 ? (
        <p>
          No channels yet;{' '}
          <Link asChild>
            <RouterLink to="/channels">add a channel</RouterLink>
          </Link>{' '}
          first
        </p>
      ) : (
        <Controller
          control={control}
          name="channelIds"
          render={({ field }) => (
            <Checkbox.Group
              value={field.value}
              onValueChange={field.onChange}
              name={field.name}
              aria-label="Channels"
              aria-invalid={errors.channelIds !== undefined}
              aria-describedby={errors.channelIds && 'channel-ids-error'}
              display="flex"
              flexWrap="wrap"
              gap="6"
            >
              {data.map((channel) => (
                <Checkbox.Root key={channel.id} value={channel.id}>
                  <Checkbox.HiddenInput />
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                  <Checkbox.Label>
                    {channel.displayName}
                    {!channel.secretConfigured && ' (webhook secret not set)'}
                  </Checkbox.Label>
                </Checkbox.Root>
              ))}
            </Checkbox.Group>
          )}
        />
      )}
      {errors.channelIds && (
        <p id="channel-ids-error" className={css({ color: 'error', textStyle: 'sm' })}>
          {errors.channelIds.message}
        </p>
      )}
    </Section>
  )
}

const MonitorForm = ({ id, initial }: { id?: string; initial: FormValues }) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const form = useForm<FormValues, unknown, MonitorConfig>({ defaultValues: initial, resolver })
  const { register, handleSubmit, setError, formState } = form

  const save = async (config: MonitorConfig) => {
    try {
      const saved = await parseResponse(
        id
          ? client.api.monitors[':id'].$put({ param: { id } }, jsonBody(config))
          : client.api.monitors.$post({}, jsonBody(config)),
      )
      if (typeof saved !== 'object') {
        throw new Error('Unexpected response from the server')
      }
      const monitorId = saved.id
      await queryClient.invalidateQueries({ queryKey: ['monitors'], refetchType: 'none' })
      await navigate({ to: '/monitors/$monitorId', params: { monitorId } })
    } catch (e) {
      const issues = issuesOf(e)
      const message = issues ? showIssues(setError, issues) : e instanceof Error ? e.message : String(e)
      if (message) {
        setError('root.server', { type: 'server', message })
      }
    }
  }

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(save)} noValidate>
        <Stack gap="6" maxW="4xl">
          <Heading as="h1" textStyle="xl">
            {id ? 'Edit monitor' : 'New monitor'}
          </Heading>
          <FormField name="name" label="Name">
            <Input {...register('name')} />
          </FormField>
          <Section title="Source and extraction">
            <Grid columns={{ base: 1, md: 2 }} gap="6">
              <ExtractionFields />
              <PreviewPanel />
            </Grid>
          </Section>
          <ConditionFields />
          <ScheduleFields />
          <ChannelFields />
          {formState.errors.root?.server && <p role="alert">{formState.errors.root.server.message}</p>}
          {id && (
            <p className={css({ color: 'fg.muted' })}>
              Saving starts a new config version and resets the baseline: the next run records a new baseline and does
              not notify
            </p>
          )}
          <HStack gap="3">
            <Button type="submit" loading={formState.isSubmitting} disabled={id !== undefined && !formState.isDirty}>
              {id ? 'Save as new version' : 'Create monitor'}
            </Button>
            <Link asChild>
              {id ? (
                <RouterLink to="/monitors/$monitorId" params={{ monitorId: id }}>
                  Cancel
                </RouterLink>
              ) : (
                <RouterLink to="/">Cancel</RouterLink>
              )}
            </Link>
          </HStack>
        </Stack>
      </form>
    </FormProvider>
  )
}

export const NewMonitor = () => <MonitorForm initial={defaultValues} />

export const EditMonitor = () => {
  const { monitorId: id } = useParams({ from: '/monitors/$monitorId/edit' })
  const { data, error, isFetchedAfterMount } = useQuery({
    queryKey: ['monitors', id],
    queryFn: () => fetchMonitor(id),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  })
  if (data && isFetchedAfterMount && !error) {
    return <MonitorForm key={id} id={id} initial={fromConfig(data)} />
  }
  if (error) {
    return <p role="alert">{httpStatus(error) === 404 ? 'Monitor not found' : error.message}</p>
  }
  return <p>Loading…</p>
}
