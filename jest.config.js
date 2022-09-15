/**
 * @type {import('@jest/types').Config.ProjectConfig}
 */
module.exports = {
  preset: 'ts-jest',
  moduleFileExtensions: ['js', 'json', 'ts'],
  modulePaths: ['.'],
  testRegex: 'test/*\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest'
  },
  coverageReporters: [
    'html',
    'cobertura'
  ],
  coverageDirectory: 'coverage',
  collectCoverageFrom: ['src/**/*.(t|j)s'],
  testEnvironment: 'node'
};
