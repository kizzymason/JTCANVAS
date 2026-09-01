import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Alert,
  App,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Steps,
  Tag,
  Typography,
} from 'antd'
import {
  DesktopOutlined,
  PlayCircleOutlined,
  SaveOutlined,
  StopOutlined,
} from '@ant-design/icons'
import { accountApi, errorMessage, registerApi } from '../services/api'
import { useServerEvents } from '../hooks/useServerEvents'
import type { Account, LiveLogEntry, QueueProgress, RegisterStatus, StatusCounts } from '../types'

const { Paragraph, Text } = Typography

const EMPTY_PROGRESS: QueueProgress = {
  running: false,
  total: 0,
  processed: 0,
  success: 0,
  failed: 0,
  active: [],
}

const EMPTY_COUNTS: StatusCounts = { pending: 0, running: 0, completed: 0, failed: 0 }

const LEVEL_COLOR: Record<LiveLogEntry['level'], string> = {
  info: '#1677ff',
  warn: '#faad14',
  error: '#ff4d4f',
  success: '#52c41a',
}

const RegisterControl: React.FC = () => {
  const { message } = App.useApp()
  const [progress, setProgress] = useState<QueueProgress>(EMPTY_PROGRESS)
  const [counts, setCounts] = useState<StatusCounts>(EMPTY_COUNTS)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [status, setStatus] = useState<RegisterStatus | null>(null)
  const [logs, setLogs] = useState<LiveLogEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [vncOpen, setVncOpen] = useState(false)
  const [assistAccountId, setAssistAccountId] = useState<number | undefined>()
  const logEndRef = useRef<HTMLDivElement>(null)

  const refresh = useCallback(async () => {
    try {
      const [statusData, accountData] = await Promise.all([registerApi.status(), accountApi.list()])
      setStatus(statusData)
      setProgress(statusData.progress)
      setCounts(accountData.counts)
      setAccounts(accountData.accounts)
      setAssistAccountId(
        (current) =>
          statusData.authSession.accountId ??
          current ??
          accountData.accounts.find((account) => account.status !== 'completed')?.id,
      )
    } catch (err) {
      message.error(errorMessage(err))
    }
  }, [message])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useServerEvents(
    useCallback(
      (event) => {
        if (event.type === 'progress') setProgress(event.payload)
        if (event.type === 'log') {
          setLogs((prev) => [...prev.slice(-299), event.payload])
        }
        if (event.type === 'queue-finished') {
          setProgress(event.payload)
          message.success(`批量注册结束：成功 ${event.payload.success}，失败 ${event.payload.failed}`)
          void refresh()
        }
        if (event.type === 'auth-session') {
          void refresh()
        }
      },
      [message, refresh],
    ),
  )

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [logs])

  const pendingCount = counts.pending

  const withBusy = async (fn: () => Promise<void>) => {
    setBusy(true)
    try {
      await fn()
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleOpenAuthSession = () =>
    withBusy(async () => {
      if (!assistAccountId) {
        message.warning('请先选择要手动处理的 Google 账号')
        return
      }
      await registerApi.openAuthSession(assistAccountId)
      message.info('已打开该账号的独立浏览器，请在 noVNC 中完成 Google 或 PiAPI 的额外验证')
      setVncOpen(true)
      await refresh()
    })

  const handleSaveAuthSession = () =>
    withBusy(async () => {
      const result = await registerApi.completeAuthSession()
      message.success(`账号浏览器已关闭并保留登录状态（${result.cookies} 个 cookie）`)
      setVncOpen(false)
      await refresh()
    })

  const handleCancelAuthSession = () =>
    withBusy(async () => {
      await registerApi.cancelAuthSession()
      message.info('已丢弃本次授权会话')
      setVncOpen(false)
      await refresh()
    })

  const handleStart = () =>
    withBusy(async () => {
      const result = await registerApi.start()
      message.success(`已开始处理 ${result.total} 个账号`)
      setLogs([])
      await refresh()
    })

  const handleStop = () =>
    withBusy(async () => {
      await registerApi.stop()
      message.warning('已请求停止，正在等待进行中的账号收尾')
      await refresh()
    })

  const percent = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0

  const currentStep = accounts.length === 0 ? 0 : progress.running ? 1 : progress.processed > 0 ? 2 : 1

  return (
    <div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="本页只负责 Google → PiAPI 自动注册"
        description={
          <>
            正常操作只有两步：先在「账号管理」导入完整 Google 邮箱、密码以及 TOTP/辅助邮箱，然后点击
            「开始 Google 批量注册」。系统会为每个账号使用独立浏览器，自动登录 Google、授权 PiAPI、
            提取 Cookie 和 API Key。下面的 noVNC 只在 Google 要求手机确认等额外验证时使用。
          </>
        }
      />
      <Steps
        current={currentStep}
        size="small"
        style={{ marginBottom: 24 }}
        items={[
          { title: '导入 Google 账号', description: '账号管理中录入验证资料' },
          { title: '开始自动注册', description: '队列逐个登录并获取 API Key' },
          { title: '查看与导出', description: '完成列表或数据导出' },
        ]}
      />

      <Row gutter={16}>
        <Col xs={24} lg={14}>
          <Card
            title="可选 · 手动处理某个 Google 账号"
            style={{ marginBottom: 16 }}
            extra={
              status?.authSession.active ? (
                <Badge status="processing" text={`正在处理账号 #${status.authSession.accountId}`} />
              ) : (
                <Badge status="default" text="未打开" />
              )
            }
          >
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              仅当日志提示「additional challenge」或 Google 要求手机/验证码确认时使用。选择失败账号后打开的是该账号
              自己的持久化 profile；手动完成后关闭浏览器，再把该账号重置为待处理并重试。
            </Paragraph>

            <Space wrap>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 300 }}
                placeholder="选择需要手动处理的 Google 账号"
                value={assistAccountId}
                disabled={status?.authSession.active}
                onChange={setAssistAccountId}
                options={accounts.map((account) => ({
                  value: account.id,
                  label: `#${account.id} ${account.username}（${account.status}）`,
                }))}
              />
              <Button
                type="primary"
                icon={<DesktopOutlined />}
                loading={busy}
                disabled={progress.running || !assistAccountId}
                onClick={() => void handleOpenAuthSession()}
              >
                打开该账号浏览器
              </Button>
              <Button
                icon={<SaveOutlined />}
                loading={busy}
                disabled={!status?.authSession.active}
                onClick={() => void handleSaveAuthSession()}
              >
                完成并关闭
              </Button>
              <Button
                loading={busy}
                disabled={!status?.authSession.active}
                onClick={() => void handleCancelAuthSession()}
              >
                关闭（未完成）
              </Button>
              <Button disabled={!vncOpen && !status?.authSession.active} onClick={() => setVncOpen(true)}>
                打开 noVNC 视图
              </Button>
            </Space>
          </Card>

          <Card title="开始 Google 批量注册">
            {pendingCount === 0 && !progress.running && (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="没有待处理的账号"
                description="请先到「账号管理」页面导入账号，或把失败的账号重置为待处理。"
              />
            )}

            <Space wrap>
              <Button
                type="primary"
                size="large"
                icon={<PlayCircleOutlined />}
                loading={busy && !progress.running}
                disabled={progress.running || status?.authSession.active || pendingCount === 0}
                onClick={() => void handleStart()}
              >
                开始批量注册（{pendingCount} 个待处理）
              </Button>
              <Button
                danger
                size="large"
                icon={<StopOutlined />}
                disabled={!progress.running}
                onClick={() => void handleStop()}
              >
                停止
              </Button>
            </Space>

            {(progress.running || progress.processed > 0) && (
              <div style={{ marginTop: 24 }}>
                <Progress
                  percent={percent}
                  status={progress.running ? 'active' : progress.failed > 0 ? 'exception' : 'success'}
                />
                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={6}>
                    <Statistic title="总数" value={progress.total} />
                  </Col>
                  <Col span={6}>
                    <Statistic title="已处理" value={progress.processed} />
                  </Col>
                  <Col span={6}>
                    <Statistic title="成功" value={progress.success} valueStyle={{ color: '#52c41a' }} />
                  </Col>
                  <Col span={6}>
                    <Statistic title="失败" value={progress.failed} valueStyle={{ color: '#ff4d4f' }} />
                  </Col>
                </Row>
                {progress.active.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <Text type="secondary">进行中：</Text>
                    <Space size={[4, 4]} wrap style={{ marginInlineStart: 8 }}>
                      {progress.active.map((name) => (
                        <Tag key={name} color="processing">
                          {name}
                        </Tag>
                      ))}
                    </Space>
                  </div>
                )}
              </div>
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card title="实时日志" bodyStyle={{ padding: 0 }}>
            <div
              style={{
                height: 520,
                overflowY: 'auto',
                padding: 12,
                background: '#0b1020',
                borderRadius: 6,
                fontFamily: 'ui-monospace, Consolas, monospace',
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {logs.length === 0 ? (
                <Empty
                  description={<span style={{ color: '#8899aa' }}>开始注册后这里会显示实时日志</span>}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  style={{ marginTop: 160 }}
                />
              ) : (
                logs.map((log, index) => (
                  <div key={`${log.at}-${index}`} style={{ color: '#c9d1d9' }}>
                    <span style={{ color: '#6b7785' }}>{new Date(log.at).toLocaleTimeString('zh-CN')}</span>{' '}
                    {log.username && <span style={{ color: '#79c0ff' }}>[{log.username}]</span>}{' '}
                    <span style={{ color: LEVEL_COLOR[log.level] }}>{log.message}</span>
                  </div>
                ))
              )}
              <div ref={logEndRef} />
            </div>
          </Card>
        </Col>
      </Row>

      <Modal
        title="noVNC · 容器内浏览器"
        open={vncOpen}
        onCancel={() => setVncOpen(false)}
        width="90vw"
        style={{ top: 20 }}
        footer={[
          <Button key="discard" onClick={() => void handleCancelAuthSession()} loading={busy}>
            关闭（未完成）
          </Button>,
          <Button key="save" type="primary" icon={<SaveOutlined />} loading={busy} onClick={() => void handleSaveAuthSession()}>
            已完成验证，关闭浏览器
          </Button>,
        ]}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="这是所选账号自己的浏览器 profile。完成 Google 手机确认、验证码或 PiAPI 授权后，点击右下角关闭；登录状态会自动保留给该账号下次重试。"
        />
        <iframe
          title="noVNC"
          src={`${status?.novncUrl ?? '/vnc/'}vnc.html?autoconnect=1&resize=scale&reconnect=1`}
          style={{ width: '100%', height: '70vh', border: '1px solid #d9d9d9', borderRadius: 6 }}
        />
      </Modal>
    </div>
  )
}

export default RegisterControl
