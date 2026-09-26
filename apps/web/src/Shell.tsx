import { Outlet, Link as RouterLink } from '@tanstack/react-router'
import { css } from 'styled-system/css'
import { Container, HStack } from 'styled-system/jsx'
import { Link } from '~/components/ui'

export const Shell = () => (
  <>
    <header className={css({ borderBottomWidth: '1px', py: '3' })}>
      <Container>
        <HStack gap="6">
          <strong>mirowler</strong>
          <nav>
            <Link asChild>
              <RouterLink to="/">Monitors</RouterLink>
            </Link>
          </nav>
        </HStack>
      </Container>
    </header>
    <main className={css({ py: '6' })}>
      <Container>
        <Outlet />
      </Container>
    </main>
  </>
)
