import { defineConfig } from '@pandacss/dev'
import { animationStyles } from '~/theme/animation-styles'
import { green } from '~/theme/colors/green'
import { neutral } from '~/theme/colors/neutral'
import { red } from '~/theme/colors/red'
import { conditions } from '~/theme/conditions'
import { globalCss } from '~/theme/global-css'
import { keyframes } from '~/theme/keyframes'
import { layerStyles } from '~/theme/layer-styles'
import { recipes, slotRecipes } from '~/theme/recipes'
import { textStyles } from '~/theme/text-styles'
import { colors } from '~/theme/tokens/colors'
import { durations } from '~/theme/tokens/durations'
import { shadows } from '~/theme/tokens/shadows'
import { zIndex } from '~/theme/tokens/z-index'

export default defineConfig({
  preflight: true,
  include: ['./src/**/*.{ts,tsx}'],
  jsxFramework: 'react',
  outdir: 'styled-system',
  globalCss: globalCss,
  conditions: conditions,

  theme: {
    extend: {
      animationStyles: animationStyles,
      recipes: recipes,
      slotRecipes: slotRecipes,
      keyframes: keyframes,
      layerStyles: layerStyles,
      textStyles: textStyles,

      tokens: {
        colors: colors,
        durations: durations,
        zIndex: zIndex,
      },

      semanticTokens: {
        radii: {
          l1: { value: '{radii.xs}' },
          l2: { value: '{radii.sm}' },
          l3: { value: '{radii.md}' },
        },

        colors: {
          canvas: { value: '{colors.gray.1}' },

          fg: {
            default: {
              value: {
                _light: '{colors.gray.12}',
                _dark: '{colors.gray.12}',
              },
            },

            muted: {
              value: {
                _light: '{colors.gray.11}',
                _dark: '{colors.gray.11}',
              },
            },

            subtle: {
              value: {
                _light: '{colors.gray.10}',
                _dark: '{colors.gray.10}',
              },
            },
          },

          border: {
            value: {
              _light: '{colors.gray.4}',
              _dark: '{colors.gray.4}',
            },
          },

          error: {
            value: {
              _light: '{colors.red.9}',
              _dark: '{colors.red.9}',
            },
          },

          gray: neutral,
          red: red,
          green: green,
        },

        shadows: shadows,
      },
    },
  },
})
