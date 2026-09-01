import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { App, Button, Col, Empty, Row, Space, Statistic, Table, Tooltip, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { accountApi, errorMessage } from '../services/api'
import { useServerEvents } from '../hooks/useServerEvents'
import StatusTag from '../components/StatusTag'
import type { Account, StatusCounts } from '../types'

const { Text } = Typography

const EMPTY_COUNTS: StatusCounts = { pending: 0, running: 0, completed: 0, failed: 0 }

const ResultsTable: React.FC = () => {
  const { message } = App.useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(false)

  const fetchData = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true)
      try {
        const data = await accountApi.list()
        setAccounts(data.accounts)
        setCounts(data.counts)
      } catch (err) {
        message.error(errorMessage(err))
      } finally {
        if (showSpinner) setLoading(false)
      }
    },
    [message],
  )

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  useServerEvents(
    useCallback(
      (event) => {
        if (event.type === 'queue-finished') void fetchData(false)
      },
      [fetchData],
    ),
  )

  const completed = useMemo(() => accounts.filter((a) => a.status === 'completed'), [accounts])

  const successRate = useMemo(() => {
    const attempted = counts.completed + counts.failed
    return attempted === 0 ? 0 : Math.round((counts.completed / attempted) * 100)
  }, [counts])

  const columns: ColumnsType<Account> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 64 },
    {
      title: 'Google 账号',
      dataIndex: 'username',
      key: 'username',
      width: 160,
      ellipsis: true,
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => <StatusTag status={status} />,
    },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      ellipsis: true,
      render: (value: string | null) =>
        value ? (
          <Text copyable style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}>
            {value}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: 'Cookie Token',
      dataIndex: 'cookieToken',
      key: 'cookieToken',
      width: 260,
      ellipsis: true,
      render: (value: string | null) =>
        value ? (
          <Tooltip title="点击复制完整值">
            <Text copyable={{ text: value }} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}>
              {value.length > 28 ? `${value.slice(0, 28)}…` : value}
            </Text>
          </Tooltip>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '完成时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: (value: string) => <Text type="secondary">{value}</Text>,
    },
  ]

  return (
    <div>
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Statistic title="账号总数" value={accounts.length} />
        </Col>
        <Col span={6}>
          <Statistic title="已完成" value={counts.completed} valueStyle={{ color: '#52c41a' }} />
        </Col>
        <Col span={6}>
          <Statistic title="失败" value={counts.failed} valueStyle={{ color: '#ff4d4f' }} />
        </Col>
        <Col span={6}>
          <Statistic title="成功率" value={successRate} suffix="%" />
        </Col>
      </Row>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchData()}>
          刷新
        </Button>
      </Space>

      <Table
        columns={columns}
        dataSource={completed}
        loading={loading}
        rowKey="id"
        size="middle"
        scroll={{ x: 900 }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        locale={{ emptyText: <Empty description="还没有成功注册的账号" /> }}
      />
    </div>
  )
}

export default ResultsTable
