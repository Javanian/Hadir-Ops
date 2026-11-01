// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'start.js', 'eslint.config.js'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      // Type information, so deprecated APIs can be flagged.
      parserOptions: { projectService: true, tsconfigRootDir: __dirname },
    },
    rules: {
      // Any API marked @deprecated (React Native, Expo, navigation, ...) fails the lint.
      '@typescript-eslint/no-deprecated': 'error',
    },
  },
]);
