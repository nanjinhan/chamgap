import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, Navigate, useParams } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import HomePage from '@/features/home/HomePage'
import NotFoundPage from '@/features/home/NotFoundPage'

// 무거운 화면(그래프 등)은 필요할 때 불러온다 (첫 화면 3초 안, NFR-06)
const ZonePage = lazy(() => import('@/features/zone/ZonePage'))
const SensorPage = lazy(() => import('@/features/sensor/SensorPage'))
const WaterPage = lazy(() => import('@/features/water/WaterPage'))
const DiagnosticsPage = lazy(() => import('@/features/diagnostics/DiagnosticsPage'))
const CalibratePage = lazy(() => import('@/features/calibrate/CalibratePage'))
const HistoryPage = lazy(() => import('@/features/history/HistoryPage'))
const TestPage = lazy(() => import('@/features/test/TestPage'))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage'))
// 개발용 데모: 빌드(production)에서는 이 import가 통째로 빠진다
const FxDemoPage = import.meta.env.DEV ? lazy(() => import('@/features/dev/FxDemoPage')) : null

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="caption p-4">불러오는 중…</div>}>{children}</Suspense>
}

function CalibrateDefault() {
  const { node } = useParams()
  return <Navigate to={`/calibrate/${node ?? 'Z1'}/scale`} replace />
}

export const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'zone/:node',
        element: (
          <Page>
            <ZonePage />
          </Page>
        ),
      },
      {
        path: 'zone/:node/sensor/:sensor',
        element: (
          <Page>
            <SensorPage />
          </Page>
        ),
      },
      {
        path: 'water',
        element: (
          <Page>
            <WaterPage />
          </Page>
        ),
      },
      {
        path: 'water/:node',
        element: (
          <Page>
            <WaterPage />
          </Page>
        ),
      },
      {
        path: 'diagnostics',
        element: (
          <Page>
            <DiagnosticsPage />
          </Page>
        ),
      },
      { path: 'calibrate/:node', element: <CalibrateDefault /> },
      {
        path: 'calibrate/:node/:kind',
        element: (
          <Page>
            <CalibratePage />
          </Page>
        ),
      },
      { path: 'history', element: <Navigate to="/history/Z1" replace /> },
      {
        path: 'history/:node',
        element: (
          <Page>
            <HistoryPage />
          </Page>
        ),
      },
      {
        path: 'test',
        element: (
          <Page>
            <TestPage />
          </Page>
        ),
      },
      {
        path: 'settings',
        element: (
          <Page>
            <SettingsPage />
          </Page>
        ),
      },
      ...(FxDemoPage
        ? [
            {
              path: 'dev/fx',
              element: (
                <Page>
                  <FxDemoPage />
                </Page>
              ),
            },
          ]
        : []),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
