import React from 'react'
import { Layout, Menu, Badge, Tooltip, theme } from 'antd'
import {
  ApiOutlined,
  UnorderedListOutlined,
  PlayCircleOutlined,
  CheckCircleOutlined,
  DownloadOutlined,
  SettingOutlined,
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useServerEvents } from '../hooks/useServerEvents'

const { Header, Sider, Content } = Layout

const SIDER_WIDTH = 240
const HEADER_HEIGHT = 64

interface NavItem {
  key: string
  path: string
  label: string
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  { key: 'accounts', path: '/accounts', label: '账号管理', icon: <UnorderedListOutlined /> },
  { key: 'register', path: '/register', label: '注册控制', icon: <PlayCircleOutlined /> },
  { key: 'results', path: '/results', label: '完成列表', icon: <CheckCircleOutlined /> },
  { key: 'export', path: '/export', label: '数据导出', icon: <DownloadOutlined /> },
  { key: 'settings', path: '/settings', label: '系统设置', icon: <SettingOutlined /> },
  { key: 'diagnostics', path: '/diagnostics', label: '接口诊断', icon: <ApiOutlined /> },
]

const MainLayout: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const {
    token: { colorBgContainer, colorBgLayout, borderRadiusLG, colorBorderSecondary },
  } = theme.useToken()

  const { connected } = useServerEvents(() => undefined)

  const activeItem =
    NAV_ITEMS.find((item) => location.pathname.startsWith(item.path)) ?? NAV_ITEMS[0]

  const items: MenuProps['items'] = NAV_ITEMS.map((item) => ({
    key: item.key,
    icon: item.icon,
    label: item.label,
  }))

  const handleMenuClick: MenuProps['onClick'] = (event) => {
    const target = NAV_ITEMS.find((item) => item.key === event.key)
    if (target) navigate(target.path)
  }

  return (
    <Layout style={{ minHeight: '100vh', background: colorBgLayout }}>
      <Sider
        width={SIDER_WIDTH}
        theme="light"
        style={{
          position: 'fixed',
          insetInlineStart: 0,
          top: 0,
          bottom: 0,
          height: '100vh',
          overflow: 'auto',
          borderInlineEnd: `1px solid ${colorBorderSecondary}`,
        }}
      >
        <div
          style={{
            height: HEADER_HEIGHT,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            borderBottom: `1px solid ${colorBorderSecondary}`,
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#1677ff' }}>PiAPI Auto</h1>
        </div>
        <Menu
          mode="inline"
          selectedKeys={[activeItem.key]}
          items={items}
          onClick={handleMenuClick}
          style={{ borderInlineEnd: 0 }}
        />
      </Sider>

      {/* Only the outer Layout compensates for the fixed Sider; the Header is a
          normal flow child, so adding padding here as well would leave a gap. */}
      <Layout style={{ marginInlineStart: SIDER_WIDTH, minHeight: '100vh' }}>
        <Header
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            height: HEADER_HEIGHT,
            lineHeight: `${HEADER_HEIGHT}px`,
            paddingInline: 24,
            background: colorBgContainer,
            borderBottom: `1px solid ${colorBorderSecondary}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{activeItem.label}</h2>
          <Tooltip title={connected ? '实时事件流已连接' : '实时事件流未连接，将退回轮询'}>
            <Badge status={connected ? 'processing' : 'default'} text={connected ? '实时' : '离线'} />
          </Tooltip>
        </Header>

        <Content
          style={{
            margin: 24,
            padding: 24,
            background: colorBgContainer,
            borderRadius: borderRadiusLG,
            minHeight: 280,
          }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}

export default MainLayout
