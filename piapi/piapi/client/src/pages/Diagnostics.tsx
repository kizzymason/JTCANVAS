import React, { useCallback, useEffect, useState } from 'react'
import { App, Badge, Button, Card, Descriptions, Input, Space, Table, Tag, Typography } from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { API_BASE, errorMessage, registerApi, systemApi } from '../services/api'
import { useServerEvents } from '../hooks/useServerEvents'
import type { RegistrationLog } from '../types'

const { Text } = Typography

const LEVEL_COLOR: Record<RegistrationLog['level'], string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
  success: 'green',
}

const Diagnostics: React.FC = () => {
  const { message } = App.useApp()
  const [health, setHealth] = useState<{ status: string; timestamp: string } | null>(null)
  const [logs, setLogs] = useState<RegistrationLog[]>([])
  const [loading, setLoading] = useState(false)
  const [secret, setSecret] = useState('Q7IQCSI25QBJCQCZ')
  const [totp, setTotp] = useState<{ code: string; secondsRemaining: number } | null>(null)

  const { connected } = useServerEvents(useCallback(() => undefined, []))

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [healthData, logData] = await Promise.all([systemApi.health(), systemApi.logs(200)])
      setHealth(healthData)
      setLogs(logData)
    } catch (err) {
      setHealth(null)
      message.error(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleTotp = async () => {
    try {
      setTotp(await registerApi.verifyTotp(secret))
    } catch (err) {
      setTotp(null)
      message.error(errorMessage(err))
    }
  }

  const columns: ColumnsType<RegistrationLog> = [
    { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 170 },
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 90,
      render: (level: RegistrationLog['level']) => <Tag color={LEVEL_COLOR[level]}>{level}</Tag>,
    },
    { title: '账号 ID', dataIndex: 'accountId', key: 'accountId', width: 90, render: (v) => v ?? '—' },
    { title: '内容', dataIndex: 'message', key: 'message' },
  ]

  return (
    <div>
      <Card
        title="服务状态"
        style={{ marginBottom: 16 }}
        extra={
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>
            刷新
          </Button>
        }
      >
        <Descriptions column={{ xs: 1, sm: 2 }} bordered size="small">
          <Descriptions.Item label="后端 API">
            {health ? <Badge status="success" text="正常" /> : <Badge status="error" text="不可用" />}
          </Descriptions.Item>
          <Descriptions.Item label="实时事件流 (SSE)">
            {connected ? <Badge status="processing" text="已连接" /> : <Badge status="default" text="未连接" />}
          </Descriptions.Item>
          <Descriptions.Item label="API 基址">
            <Text code>{API_BASE}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="服务器时间">{health?.timestamp ?? '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="TOTP 验证工具" style={{ marginBottom: 16 }}>
        <Space.Compact style={{ width: '100%', maxWidth: 560 }}>
          <Input
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="粘贴 base32 密钥，例如 Q7IQCSI25QBJCQCZ"
            style={{ fontFamily: 'ui-monospace, Consolas, monospace' }}
          />
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => void handleTotp()}>
            生成验证码
          </Button>
        </Space.Compact>
        {totp && (
          <div style={{ marginTop: 12 }}>
            <Tag color="geekblue" style={{ fontSize: 20, padding: '4px 12px', fontFamily: 'ui-monospace, Consolas, monospace' }}>
              {totp.code}
            </Tag>
            <Text type="secondary">{totp.secondsRemaining} 秒后失效</Text>
          </div>
        )}
      </Card>

      <Card title="系统日志">
        <Table
          columns={columns}
          dataSource={logs}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        />
      </Card>
    </div>
  )
}

export default Diagnostics
