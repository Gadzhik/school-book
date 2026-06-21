<script lang="ts">
  /** Предупреждение о бета-ИИ. Показывается один раз перед первым использованием. */
  import { llmDisclaimerOpen, acceptLlm, declineLlm, disableLlm } from './llm-consent';
</script>

{#if $llmDisclaimerOpen}
  <div class="backdrop" role="presentation" onclick={declineLlm}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-label="ИИ в тестировании">
    <h2>🤖 ИИ-помощник <span class="beta">бета</span></h2>
    <p>
      ИИ-функции (объяснение, краткое содержание, квиз, улучшение распознанного
      текста) работают через локальную модель и находятся <strong>в тестировании</strong>.
    </p>
    <ul>
      <li>Ответы могут быть <strong>неточными или выдуманными</strong>.</li>
      <li>Не используйте их для оценок и важных решений — проверяйте сами.</li>
      <li>На слабом сервере ответы бывают медленными.</li>
    </ul>
    <div class="actions">
      <button class="ghost" onclick={disableLlm}>Отключить ИИ</button>
      <button class="primary" onclick={acceptLlm}>Понятно, продолжить</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgba(0, 0, 0, 0.4);
  }
  .modal {
    position: fixed;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 61;
    width: min(440px, 92vw);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    padding: 1.2rem 1.3rem 1.1rem;
  }
  h2 {
    margin: 0 0 0.6rem;
    font-size: 1.2rem;
    color: var(--text);
  }
  .beta {
    font-size: 0.7rem;
    font-weight: 700;
    vertical-align: middle;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: #d9a400;
    color: #1a1400;
  }
  p {
    color: var(--text);
    line-height: 1.5;
    margin: 0 0 0.6rem;
  }
  ul {
    margin: 0 0 1rem;
    padding-left: 1.2rem;
    color: var(--muted);
    line-height: 1.5;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.6rem;
  }
  .primary {
    border: none;
    border-radius: 9px;
    background: var(--accent);
    color: var(--on-accent);
    padding: 0.6rem 1rem;
    font-weight: 700;
    cursor: pointer;
  }
  .ghost {
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text);
    padding: 0.6rem 1rem;
    cursor: pointer;
  }
</style>
