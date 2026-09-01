import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Segmented,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd'
import {
  DeleteOutlined,
  FileTextOutlined,
  ImportOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { accountApi, errorMessage } from '../services/api'
import { useServerEvents } from '../hooks/useServerEvents'
import BulkImportModal from '../components/BulkImportModal'
import StatusTag from '../components/StatusTag'
import type { Account, AccountStatus, RegistrationLog, StatusCounts } from '../types'

const { Text } = Typography

const EMPTY_COUNTS: StatusCounts = { pending: 0, running: 0, completed: 0, failed: 0 }

interface AddFormValues {
  username: string
  password: string
  totpSecret: string
  recoveryEmail: string
}

const AccountList: React.FC = () => {
  const { message } = App.useApp()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<AccountStatus | 'all'>('all')
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [syncingKeyIds, setSyncingKeyIds] = useState<number[]>([])
  const [syncingKeys, setSyncingKeys] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [form] = Form.useForm<AddFormValues>()

  const [logDrawer, setLogDrawer] = useState<{ account: Account; logs: RegistrationLog[] } | null>(null)
  const [totpCodes, setTotpCodes] = useState<Record<number, string>>({})

  const fetchAccounts = useCallback(
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
    void fetchAccounts()
  }, [fetchAccounts])

  // Keep rows in sync while a registration run is in flight.
  useServerEvents(
    useCallback((event) => {
      if (event.type === 'account') {
        const updated = event.payload
        setAccounts((prev) => {
          const index = prev.findIndex((a) => a.id === updated.id)
          if (index === -1) return [...prev, updated]
          const next = [...prev]
          next[index] = updated
          return next
        })
      }
      if (event.type === 'queue-finished') {
        void fetchAccounts(false)
      }
    }, [fetchAccounts]),
  )

  // Codes roll over every 30s; refresh the whole visible set on a timer.
  useEffect(() => {
    let cancelled = false

    const refreshCodes = async () => {
      const visible = accounts.slice(0, 50)
      const entries = await Promise.all(
        visible.map(async (acc) => {
          if (!acc.totpSecret) return [acc.id, '—'] as const
          try {
            const { code } = await accountApi.totp(acc.id)
            return [acc.id, code] as const
          } catch {
            return [acc.id, '—'] as const
          }
        }),
      )
      if (!cancelled) setTotpCodes(Object.fromEntries(entries))
    }

    if (accounts.length > 0) {
      void refreshCodes()
      const timer = window.setInterval(refreshCodes, 15000)
      return () => {
        cancelled = true
        window.clearInterval(timer)
      }
    }
    return () => {
      cancelled = true
    }
  }, [accounts])

  const filtered = useMemo(
    () => (filter === 'all' ? accounts : accounts.filter((a) => a.status === filter)),
    [accounts, filter],
  )

  const handleAdd = async (values: AddFormValues) => {
    setAdding(true)
    try {
      await accountApi.create({
        ...values,
        totpSecret: values.totpSecret ?? '',
        recoveryEmail: values.recoveryEmail ?? '',
      })
      message.success('添加成功')
      setAddOpen(false)
      form.resetFields()
      await fetchAccounts(false)
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await accountApi.remove(id)
      message.success('删除成功')
      setSelectedIds((prev) => prev.filter((x) => x !== id))
      await fetchAccounts(false)
    } catch (err) {
      message.error(errorMessage(err))
    }
  }

  const handleBulkDelete = async () => {
    try {
      const { deleted } = await accountApi.bulkDelete(selectedIds)
      message.success(`已删除 ${deleted} 个账号`)
      setSelectedIds([])
      await fetchAccounts(false)
    } catch (err) {
      message.error(errorMessage(err))
    }
  }

  const handleResetFailed = async () => {
    try {
      const { reset } = await accountApi.reset('failed')
      message.success(`已将 ${reset} 个失败账号重置为待处理`)
      await fetchAccounts(false)
    } catch (err) {
      message.error(errorMessage(err))
    }
  }

  const openLogs = async (account: Account) => {
    try {
      const logs = await accountApi.logs(account.id)
      setLogDrawer({ account, logs })
    } catch (err) {
      message.error(errorMessage(err))
    }
  }

  const replaceAccount = (updated: Account) => {
    setAccounts((current) => current.map((account) => (account.id === updated.id ? updated : account)))
  }

  const handleSyncApiKey = async (account: Account) => {
    setSyncingKeyIds((current) => [...current, account.id])
    try {
      const updated = await accountApi.syncApiKey(account.id)
      replaceAccount(updated)
      message.success(`已获取 ${account.username} 的 API Key`)
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setSyncingKeyIds((current) => current.filter((id) => id !== account.id))
    }
  }

  const handleSyncApiKeys = async () => {
    const selected = new Set(selectedIds)
    const targets =
      selectedIds.length > 0
        ? accounts.filter((account) => selected.has(account.id) && account.status === 'completed')
        : accounts.filter((account) => account.status === 'completed' && !account.apiKey)

    if (targets.length === 0) {
      message.warning(selectedIds.length > 0 ? '选中的账号尚未完成注册' : '没有缺少 API Key 的已完成账号')
      return
    }

    setSyncingKeys(true)
    try {
      const result = await accountApi.syncApiKeys(
        targets.map((account) => account.id),
        selectedIds.length > 0,
      )
      await fetchAccounts(false)
      if (result.failed > 0) {
        message.warning(`已获取 ${result.synced} 个，跳过 ${result.skipped} 个，失败 ${result.failed} 个`)
      } else {
        message.success(`已获取 ${result.synced} 个 API Key${result.skipped ? `，跳过 ${result.skipped} 个` : ''}`)
      }
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setSyncingKeys(false)
    }
  }

  const columns: ColumnsType<Account> = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 64 },
    {
      title: 'Google 主账号',
      dataIndex: 'username',
      key: 'username',
      width: 160,
      ellipsis: true,
      render: (name: string) => <Text strong>{name}</Text>,
    },
    {
      title: '2FA 密钥',
      dataIndex: 'totpSecret',
      key: 'totpSecret',
      width: 190,
      render: (secret: string) =>
        secret ? (
          <Text copyable={{ text: secret }} style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}>
            {secret}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '辅助邮箱',
      dataIndex: 'recoveryEmail',
      key: 'recoveryEmail',
      width: 210,
      ellipsis: true,
      render: (email: string) =>
        email ? <Text copyable={{ text: email }}>{email}</Text> : <Text type="secondary">—</Text>,
    },
    {
      title: '当前验证码',
      key: 'totpCode',
      width: 120,
      render: (_, record) => {
        const code = totpCodes[record.id]
        return code ? (
          <Tag color="geekblue" style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 14 }}>
            {code}
          </Tag>
        ) : (
          <Text type="secondary">…</Text>
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string, record) =>
        record.lastError ? (
          <Tooltip title={record.lastError}>
            <span>
              <StatusTag status={status} />
            </span>
          </Tooltip>
        ) : (
          <StatusTag status={status} />
        ),
    },
    { title: '尝试', dataIndex: 'attempts', key: 'attempts', width: 64 },
    {
      title: 'API Key',
      dataIndex: 'apiKey',
      key: 'apiKey',
      width: 200,
      ellipsis: true,
      render: (value: string | null) =>
        value ? (
          <Text
            copyable={{ text: value, tooltips: ['复制完整 API Key', '已复制'] }}
            style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
          >
            {`${value.slice(0, 8)}…${value.slice(-4)}`}
          </Text>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: '操作',
      key: 'action',
      width: 190,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          {record.status === 'completed' && (
            <Tooltip title={record.apiKey ? '重新提取 API Key' : '获取 API Key'}>
              <Button
                size="small"
                icon={<KeyOutlined />}
                loading={syncingKeyIds.includes(record.id)}
                onClick={() => void handleSyncApiKey(record)}
              />
            </Tooltip>
          )}
          <Tooltip title="查看日志">
            <Button size="small" icon={<FileTextOutlined />} onClick={() => void openLogs(record)} />
          </Tooltip>
          <Popconfirm
            title="确定删除此账号？"
            description="该账号的日志也会一并删除。"
            onConfirm={() => void handleDelete(record.id)}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
          >
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <Space style={{ marginBottom: 16 }} wrap>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
          添加账号
        </Button>
        <Button icon={<ImportOutlined />} onClick={() => setBulkOpen(true)}>
          批量导入
        </Button>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchAccounts()}>
          刷新
        </Button>
        <Button
          icon={<KeyOutlined />}
          loading={syncingKeys}
          disabled={
            selectedIds.length > 0
              ? !accounts.some((account) => selectedIds.includes(account.id) && account.status === 'completed')
              : !accounts.some((account) => account.status === 'completed' && !account.apiKey)
          }
          onClick={() => void handleSyncApiKeys()}
        >
          {selectedIds.length > 0 ? `获取所选 API Key (${selectedIds.length})` : '补齐全部 API Key'}
        </Button>
        <Popconfirm
          title={`删除选中的 ${selectedIds.length} 个账号？`}
          onConfirm={() => void handleBulkDelete()}
          okText="删除"
          okButtonProps={{ danger: true }}
          cancelText="取消"
          disabled={selectedIds.length === 0}
        >
          <Button danger icon={<DeleteOutlined />} disabled={selectedIds.length === 0}>
            批量删除 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </Button>
        </Popconfirm>
        <Popconfirm
          title="将所有失败账号重置为待处理？"
          onConfirm={() => void handleResetFailed()}
          okText="重置"
          cancelText="取消"
          disabled={counts.failed === 0}
        >
          <Button disabled={counts.failed === 0}>重置失败 ({counts.failed})</Button>
        </Popconfirm>
      </Space>

      <Segmented
        style={{ marginBottom: 16 }}
        value={filter}
        onChange={(value) => setFilter(value as AccountStatus | 'all')}
        options={[
          { label: `全部 (${accounts.length})`, value: 'all' },
          { label: `待处理 (${counts.pending})`, value: 'pending' },
          { label: `进行中 (${counts.running})`, value: 'running' },
          { label: `已完成 (${counts.completed})`, value: 'completed' },
          { label: `失败 (${counts.failed})`, value: 'failed' },
        ]}
      />

      <Table
        columns={columns}
        dataSource={filtered}
        loading={loading}
        rowKey="id"
        size="middle"
        scroll={{ x: 1360 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys as number[]),
        }}
        pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
        locale={{
          emptyText: (
            <Empty description="还没有账号，点击「批量导入」粘贴账号、密码和 TOTP/辅助邮箱" />
          ),
        }}
      />

      <Modal
        title="添加单个账号"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adding}
        okText="添加"
        cancelText="取消"
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleAdd} requiredMark={false}>
          <Form.Item
            label="Google 主账号邮箱"
            name="username"
            rules={[
              { required: true, message: '请输入 Google 主账号邮箱' },
              { type: 'email', message: '请输入完整邮箱地址' },
            ]}
          >
            <Input placeholder="user@example.org" autoComplete="off" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder="r7BTElJsImP" autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            label="2FA TOTP 密钥"
            name="totpSecret"
            dependencies={['recoveryEmail']}
            rules={[
              {
                validator: (_, value: string) => {
                  const recovery = form.getFieldValue('recoveryEmail')
                  if (!value && !recovery) return Promise.reject(new Error('TOTP 和辅助邮箱至少填一个'))
                  if (value && !/^[A-Za-z2-7\s-]{8,}$/.test(value)) {
                    return Promise.reject(new Error('TOTP 必须是 base32（A-Z、2-7），至少 8 位'))
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input placeholder="Q7IQCSI25QBJCQCZ" autoComplete="off" />
          </Form.Item>
          <Form.Item
            label="Google 辅助邮箱"
            name="recoveryEmail"
            dependencies={['totpSecret']}
            rules={[
              { type: 'email', message: '辅助邮箱格式不正确' },
              {
                validator: (_, value: string) => {
                  if (!value && !form.getFieldValue('totpSecret')) {
                    return Promise.reject(new Error('TOTP 和辅助邮箱至少填一个'))
                  }
                  return Promise.resolve()
                },
              },
            ]}
          >
            <Input placeholder="recovery@gmail.com" autoComplete="off" />
          </Form.Item>
        </Form>
      </Modal>

      <BulkImportModal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onImported={() => void fetchAccounts(false)}
      />

      <Drawer
        title={logDrawer ? `${logDrawer.account.username} 的日志` : ''}
        open={logDrawer !== null}
        onClose={() => setLogDrawer(null)}
        width={620}
      >
        {logDrawer && (
          <>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                <StatusTag status={logDrawer.account.status} />
              </Descriptions.Item>
              <Descriptions.Item label="尝试次数">{logDrawer.account.attempts}</Descriptions.Item>
              <Descriptions.Item label="最后错误">
                {logDrawer.account.lastError ?? '—'}
              </Descriptions.Item>
            </Descriptions>

            {logDrawer.account.screenshotPath && (
              <Card size="small" title="失败截图" style={{ marginBottom: 16 }}>
                <img
                  src={`/api/screenshots/${logDrawer.account.screenshotPath}`}
                  alt="失败截图"
                  style={{ width: '100%', borderRadius: 6 }}
                />
              </Card>
            )}

            {logDrawer.logs.length === 0 ? (
              <Empty description="暂无日志" />
            ) : (
              <Timeline
                items={logDrawer.logs.map((log) => ({
                  color:
                    log.level === 'error'
                      ? 'red'
                      : log.level === 'success'
                        ? 'green'
                        : log.level === 'warn'
                          ? 'orange'
                          : 'blue',
                  children: (
                    <>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {log.createdAt}
                      </Text>
                      <div>{log.message}</div>
                    </>
                  ),
                }))}
              />
            )}
          </>
        )}
      </Drawer>
    </div>
  )
}

export default AccountList
