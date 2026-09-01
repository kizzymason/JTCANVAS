import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Collapse,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  Spin,
  Switch,
  Tooltip,
  Typography,
} from 'antd'
import { ReloadOutlined, SaveOutlined } from '@ant-design/icons'
import ProxyPoolCard from '../components/ProxyPoolCard'
import { errorMessage, settingsApi } from '../services/api'
import type { AppSettings, ProxyPool, SelectorSet } from '../types'

const { Paragraph, Text } = Typography
const { TextArea } = Input

const EMPTY_POOL: ProxyPool = {
  enabled: false,
  strategy: 'per-account',
  entries: [],
}

const SELECTOR_LABELS: Record<keyof SelectorSet, string> = {
  piapiLoginTrigger: 'piapi.ai 打开登录弹窗的按钮',
  piapiGoogleSignInButton: 'piapi.ai 的 Google 登录按钮',
  googleEmailField: 'Google 邮箱输入框',
  googleEmailNextButton: 'Google 邮箱页「下一步」',
  googlePasswordField: 'Google 密码输入框',
  googlePasswordNextButton: 'Google 密码页「下一步」',
  googleOtpField: 'Google 2FA 验证码输入框',
  googleOtpSubmitButton: 'Google 2FA 提交按钮',
  googleWelcomeButton: 'Google Workspace 首次登录确认按钮',
  googleRecoveryChoice: 'Google「确认辅助邮箱」验证方式',
  googleRecoveryEmailField: 'Google 辅助邮箱输入框',
  googleRecoverySubmitButton: 'Google 辅助邮箱提交按钮',
  googleConsentButton: 'Google 授权确认按钮',
  googleErrorText: 'Google 内联报错文案所在元素',
  piapiLoggedInMarker: 'piapi.ai 已登录标志元素',
}

/**
 * Selector textareas are flattened into `selector_<key>` fields for antd's Form.
 * The proxy pool is nested and dynamic, so it lives in React state instead and
 * is merged back in at save time.
 */
type FormValues = Omit<AppSettings, 'selectors' | 'cookieTokenNames' | 'proxyPool'> & {
  cookieTokenNames: string
} & Record<string, string | number | boolean>

function toFormValues(settings: AppSettings): FormValues {
  const { selectors, cookieTokenNames, proxyPool, ...scalars } = settings

  const selectorFields = Object.fromEntries(
    (Object.keys(selectors) as Array<keyof SelectorSet>).map((key) => [
      `selector_${key}`,
      selectors[key].join('\n'),
    ]),
  )

  return {
    ...scalars,
    cookieTokenNames: cookieTokenNames.join('\n'),
    ...selectorFields,
  }
}

function splitLines(value: unknown): string[] {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function toPatch(values: FormValues, proxyPool: ProxyPool): Partial<AppSettings> {
  const selectors = Object.fromEntries(
    (Object.keys(SELECTOR_LABELS) as Array<keyof SelectorSet>).map((key) => [
      key,
      splitLines(values[`selector_${key}`]),
    ]),
  ) as unknown as SelectorSet

  return {
    maxConcurrent: values.maxConcurrent,
    maxRetries: values.maxRetries,
    navigationTimeoutMs: values.navigationTimeoutMs,
    actionTimeoutMs: values.actionTimeoutMs,
    headless: values.headless,
    dryRun: values.dryRun,
    proxyPool: {
      ...proxyPool,
      entries: proxyPool.entries.filter((entry) => entry.url.trim()),
    },
    piapiBaseUrl: values.piapiBaseUrl,
    piapiWorkspaceUrl: values.piapiWorkspaceUrl,
    cookieTokenNames: splitLines(values.cookieTokenNames),
    selectors,
  }
}

const SettingsPage: React.FC = () => {
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<FormValues>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dryRun, setDryRun] = useState(false)
  const [proxyPool, setProxyPool] = useState<ProxyPool>(EMPTY_POOL)

  const applySettings = useCallback(
    (settings: AppSettings) => {
      form.setFieldsValue(toFormValues(settings))
      setDryRun(settings.dryRun)
      setProxyPool(settings.proxyPool ?? EMPTY_POOL)
    },
    [form],
  )

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { settings } = await settingsApi.get()
      applySettings(settings)
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [applySettings, message])

  useEffect(() => {
    void load()
  }, [load])

  const handleSave = async (values: FormValues) => {
    setSaving(true)
    try {
      applySettings(await settingsApi.save(toPatch(values, proxyPool)))
      message.success('设置已保存，立即生效')
    } catch (err) {
      message.error(errorMessage(err))
    } finally {
      setSaving(false)
    }
  }

  /**
   * The proxy checks run server-side against stored settings, so anything typed
   * but not yet saved would silently not be used. Persist first.
   */
  const persistCurrent = useCallback(async () => {
    const saved = await settingsApi.save(toPatch(form.getFieldsValue(), proxyPool))
    setProxyPool(saved.proxyPool ?? EMPTY_POOL)
  }, [form, proxyPool])

  const handleResetDefaults = () => {
    modal.confirm({
      title: '恢复默认设置？',
      content: '包括所有选择器都会被重置为出厂默认值。代理池会被保留。',
      okText: '恢复默认',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          applySettings(await settingsApi.reset())
          message.success('已恢复默认设置')
        } catch (err) {
          message.error(errorMessage(err))
        }
      },
    })
  }

  const dangerAction = (
    title: string,
    content: string,
    action: () => Promise<string>,
  ): void => {
    modal.confirm({
      title,
      content,
      okText: '确定执行',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        try {
          message.success(await action())
        } catch (err) {
          message.error(errorMessage(err))
        }
      },
    })
  }

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 80 }}>
        <Spin size="large" />
      </div>
    )
  }

  return (
    <Form form={form} layout="vertical" onFinish={handleSave} requiredMark={false}>
      {dryRun && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="DRY-RUN 已开启"
          description="批量注册不会访问真实网站，只会模拟流程并写入假的 API Key，方便先把界面链路跑通。"
        />
      )}

      <Card title="运行参数" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item
              label="并发数"
              name="maxConcurrent"
              tooltip="同时打开几个 Google 登录浏览器。并发过高容易触发额外验证，建议 1-3。"
              rules={[{ required: true, message: '请输入并发数' }]}
            >
              <InputNumber min={1} max={10} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="失败重试次数" name="maxRetries" rules={[{ required: true }]}>
              <InputNumber min={0} max={5} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="导航超时 (ms)" name="navigationTimeoutMs" rules={[{ required: true }]}>
              <InputNumber min={5000} max={180000} step={5000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="元素等待超时 (ms)" name="actionTimeoutMs" rules={[{ required: true }]}>
              <InputNumber min={1000} max={120000} step={1000} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item
              label="DRY-RUN 模拟模式"
              name="dryRun"
              valuePropName="checked"
              tooltip="开启后不会访问真实网站，用于验证界面与队列。"
            >
              <Switch onChange={setDryRun} checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item
              label="无头模式"
              name="headless"
              valuePropName="checked"
              tooltip="容器内已有虚拟显示器，会自动使用有头模式以便 noVNC 观察；该开关只在非容器环境生效。"
            >
              <Switch checkedChildren="开" unCheckedChildren="关" />
            </Form.Item>
          </Col>
        </Row>

        <Alert
          type="info"
          showIcon
          message="每个账号使用独立的浏览器 profile"
          description="Google 与 PiAPI 登录状态按账号隔离并持久化。失败后可以在「注册控制」中打开该账号自己的 noVNC 浏览器，手动完成额外验证。"
        />
      </Card>

      <Card title="Google 登录" style={{ marginBottom: 16 }}>
        <Alert
          type="info"
          showIcon
          message="系统只使用 Google OAuth"
          description={
            <>
              主账号必须填写完整邮箱和密码，并至少提供一种验证资料：Google Authenticator 的
              <Text code> TOTP 密钥</Text>或<Text code>辅助邮箱</Text>。遇到手机确认、验证码或其他额外挑战时，
              到「注册控制」选择该账号并打开 noVNC 手动完成一次。
            </>
          }
        />
      </Card>

      <ProxyPoolCard value={proxyPool} onChange={setProxyPool} onPersist={persistCurrent} />

      <Card title="目标站点" style={{ marginBottom: 16 }}>
        <Row gutter={16}>
          <Col xs={24} md={12}>
            <Form.Item label="piapi.ai 主域名" name="piapiBaseUrl" rules={[{ required: true }]}>
              <Input placeholder="https://piapi.ai" />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item label="登录入口 URL" name="piapiWorkspaceUrl" rules={[{ required: true }]}>
              <Input placeholder="https://piapi.ai/workspace" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Cookie Token 名称候选"
          name="cookieTokenNames"
          tooltip="每行一个，按顺序匹配（子串匹配，不区分大小写）。"
        >
          <TextArea autoSize={{ minRows: 3, maxRows: 6 }} style={{ fontFamily: 'ui-monospace, Consolas, monospace' }} />
        </Form.Item>
      </Card>

      <Card title="页面选择器" style={{ marginBottom: 16 }}>
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          每行一个 Playwright 选择器，程序按顺序尝试，第一个可见的生效。Google 和 piapi.ai
          随时可能改版，改这里即可，无需重新构建镜像。可以先在 <Text code>注册控制</Text> 页用 noVNC
          打开页面，肉眼确认元素后再回来调整。
        </Paragraph>

        <Collapse
          items={(Object.keys(SELECTOR_LABELS) as Array<keyof SelectorSet>).map((key) => ({
            key,
            label: (
              <Tooltip title={key}>
                <span>{SELECTOR_LABELS[key]}</span>
              </Tooltip>
            ),
            children: (
              <Form.Item name={`selector_${key}`} noStyle>
                <TextArea
                  autoSize={{ minRows: 2, maxRows: 10 }}
                  style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 12 }}
                />
              </Form.Item>
            ),
          }))}
        />
      </Card>

      <Card title="数据清理" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Button
            danger
            onClick={() =>
              dangerAction('清空所有已完成账号？', '已完成的账号及其日志会被永久删除。', async () => {
                const { deleted } = await settingsApi.clearCompleted()
                return `已删除 ${deleted} 个已完成账号`
              })
            }
          >
            清空所有已完成账号
          </Button>
          <Button
            danger
            onClick={() =>
              dangerAction('清除浏览器缓存？', '所有账号的独立浏览器 profile 都会被删除，下次需要重新登录。', async () => {
                await settingsApi.clearBrowser()
                return '浏览器数据已清除'
              })
            }
          >
            清除浏览器缓存
          </Button>
          <Button
            danger
            onClick={() =>
              dangerAction(
                '删除所有单账号浏览器 profile？',
                '每个账号的独立 profile 目录会被删除，下次注册重新创建。手动授权用的 profile 保留。',
                async () => {
                  const { deleted } = await settingsApi.clearProfiles()
                  return `已删除 ${deleted} 个 profile`
                },
              )
            }
          >
            清理账号 profile
          </Button>
          <Button
            onClick={() =>
              dangerAction('清空所有日志？', '仅删除日志记录，不影响账号数据。', async () => {
                await settingsApi.clearLogs()
                return '日志已清空'
              })
            }
          >
            清空日志
          </Button>
          <Button
            onClick={() =>
              dangerAction('删除所有失败截图？', '仅删除截图文件。', async () => {
                const { deleted } = await settingsApi.clearScreenshots()
                return `已删除 ${deleted} 张截图`
              })
            }
          >
            删除失败截图
          </Button>
        </Space>
      </Card>

      <Space>
        <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
          保存设置
        </Button>
        <Button icon={<ReloadOutlined />} onClick={() => void load()}>
          重新载入
        </Button>
        <Button danger onClick={handleResetDefaults}>
          恢复默认
        </Button>
      </Space>
    </Form>
  )
}

export default SettingsPage
