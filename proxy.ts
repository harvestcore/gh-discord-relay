const DISCORD_WEBHOOK_URL = Deno.env.get('DISCORD_WEBHOOK_URL') || '';
const PORT = parseInt(Deno.env.get('PORT') || '8080');

// deno-lint-ignore no-explicit-any
type GitHubPayload = Record<string, any>;

interface DiscordEmbed {
    title?: string;
    description?: string;
    url?: string;
    color?: number;
    author?: { name: string; url?: string; icon_url?: string };
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    thumbnail?: { url: string };
    timestamp?: string;
}

interface DiscordWebhookPayload {
    content?: string;
    username?: string;
    avatar_url?: string;
    embeds?: DiscordEmbed[];
}

const COLORS = {
    green: 0x2ecc71,
    red: 0xe74c3c,
    blue: 0x3498db,
    yellow: 0xf39c12,
    purple: 0x9b59b6,
    orange: 0xe67e22,
    gray: 0x95a5a6,
    cyan: 0x1abc9c,
    pink: 0xe91e63,
};

function truncate(text: string | undefined | null, maxLength: number): string {
    if (!text) return '';
    return text.length > maxLength ? text.substring(0, maxLength - 3) + '...' : text;
}

function getBaseEmbed(payload: GitHubPayload): Partial<DiscordEmbed> {
    return {
        author: payload.sender
            ? {
                  name: payload.sender.login,
                  url: payload.sender.html_url,
                  icon_url: payload.sender.avatar_url,
              }
            : undefined,
        footer: payload.repository ? { text: payload.repository.full_name } : undefined,
        timestamp: new Date().toISOString(),
    };
}

function createDiscordPayload(embed: DiscordEmbed): DiscordWebhookPayload {
    return {
        username: 'GitHub',
        avatar_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        embeds: [embed],
    };
}

type EventHandler = (payload: GitHubPayload) => DiscordEmbed;

const eventHandlers: Record<string, EventHandler> = {
    ping: payload => ({
        ...getBaseEmbed(payload),
        title: '🏓 Webhook Configurado',
        description: `El webhook para **${payload.repository?.full_name}** está funcionando.\n\nZen: *${payload.zen}*`,
        color: COLORS.green,
        url: payload.repository?.html_url,
    }),

    push: payload => {
        const branch = payload.ref?.replace('refs/heads/', '').replace('refs/tags/', '');
        const isTag = payload.ref?.startsWith('refs/tags/');
        const commits = payload.commits || [];
        const commitCount = commits.length;

        let description = '';
        if (isTag) {
            description = `Tag \`${branch}\` was pushed`;
        } else if (payload.forced) {
            description = `⚠️ **Force pushed** to \`${branch}\``;
        } else if (commitCount === 0) {
            description = `Branch \`${branch}\` was updated`;
        } else {
            description = `**${commitCount}** commit(s) to \`${branch}\`\n\n`;
            commits
                .slice(0, 10)
                .forEach((commit: { id: string; message: string; url: string; author: { name: string } }) => {
                    const shortId = commit.id.substring(0, 7);
                    const message = truncate(commit.message.split('\n')[0], 50);
                    description += `[\`${shortId}\`](${commit.url}) ${message} - ${commit.author.name}\n`;
                });
            if (commitCount > 10) description += `\n*...and ${commitCount - 10} more commits*`;
        }

        return {
            ...getBaseEmbed(payload),
            title: isTag ? '🏷️ Tag Pushed' : `📤 Push to ${payload.repository?.name}`,
            description,
            url: payload.compare || payload.repository?.html_url,
            color: payload.forced ? COLORS.orange : COLORS.green,
        };
    },

    pull_request: payload => {
        const pr = payload.pull_request;
        const action = payload.action;

        const actionEmojis: Record<string, string> = {
            opened: '🆕',
            closed: pr?.merged ? '🎉' : '❌',
            reopened: '🔄',
            edited: '✏️',
            assigned: '👤',
            unassigned: '👤',
            review_requested: '👀',
            labeled: '🏷️',
            unlabeled: '🏷️',
            synchronize: '🔄',
            ready_for_review: '✅',
            converted_to_draft: '📝',
            locked: '🔒',
            unlocked: '🔓',
        };

        const actionColors: Record<string, number> = {
            opened: COLORS.green,
            closed: pr?.merged ? COLORS.purple : COLORS.red,
            reopened: COLORS.green,
        };

        const emoji = actionEmojis[action] || '🔀';
        const color = actionColors[action] || COLORS.blue;
        const actionText = pr?.merged ? 'merged' : action;

        return {
            ...getBaseEmbed(payload),
            title: `${emoji} Pull Request ${actionText}: #${pr?.number}`,
            description: `**${pr?.title}**\n\n${truncate(pr?.body, 500)}\n\n\`${pr?.head?.ref}\` → \`${pr?.base?.ref}\``,
            url: pr?.html_url,
            color,
            fields: [
                { name: 'Commits', value: String(pr?.commits || 0), inline: true },
                { name: 'Changed Files', value: String(pr?.changed_files || 0), inline: true },
                { name: '+/-', value: `+${pr?.additions || 0} / -${pr?.deletions || 0}`, inline: true },
            ],
        };
    },

    pull_request_review: payload => {
        const review = payload.review;
        const pr = payload.pull_request;

        const stateEmojis: Record<string, string> = {
            approved: '✅',
            changes_requested: '🔄',
            commented: '💬',
            dismissed: '❌',
        };
        const stateColors: Record<string, number> = {
            approved: COLORS.green,
            changes_requested: COLORS.orange,
            commented: COLORS.blue,
            dismissed: COLORS.gray,
        };

        const state = review?.state?.toLowerCase() || 'submitted';
        return {
            ...getBaseEmbed(payload),
            title: `${stateEmojis[state] || '👀'} PR Review: ${state.replace('_', ' ')}`,
            description: `Review on **#${pr?.number}: ${pr?.title}**\n\n${truncate(review?.body, 500)}`,
            url: review?.html_url,
            color: stateColors[state] || COLORS.blue,
        };
    },

    pull_request_review_comment: payload => {
        const comment = payload.comment;
        const pr = payload.pull_request;
        return {
            ...getBaseEmbed(payload),
            title: `💬 Review Comment on PR #${pr?.number}`,
            description: `**${pr?.title}**\n\n${truncate(comment?.body, 500)}\n\n*File: \`${comment?.path}\`*`,
            url: comment?.html_url,
            color: COLORS.blue,
        };
    },

    issues: payload => {
        const issue = payload.issue;
        const action = payload.action;

        const actionEmojis: Record<string, string> = {
            opened: '🆕',
            closed: '✅',
            reopened: '🔄',
            edited: '✏️',
            assigned: '👤',
            unassigned: '👤',
            labeled: '🏷️',
            unlabeled: '🏷️',
            pinned: '📌',
            unpinned: '📌',
            locked: '🔒',
            unlocked: '🔓',
            transferred: '➡️',
            milestoned: '🎯',
            demilestoned: '🎯',
        };

        const actionColors: Record<string, number> = {
            opened: COLORS.green,
            closed: COLORS.purple,
            reopened: COLORS.green,
        };
        const labels = issue?.labels?.map((l: { name: string }) => `\`${l.name}\``).join(', ') || 'None';

        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '📋'} Issue ${action}: #${issue?.number}`,
            description: `**${issue?.title}**\n\n${truncate(issue?.body, 500)}`,
            url: issue?.html_url,
            color: actionColors[action] || COLORS.blue,
            fields: [
                { name: 'Labels', value: labels, inline: true },
                { name: 'State', value: issue?.state || 'unknown', inline: true },
            ],
        };
    },

    issue_comment: payload => {
        const comment = payload.comment;
        const issue = payload.issue;
        const isPR = !!issue?.pull_request;
        return {
            ...getBaseEmbed(payload),
            title: `💬 Comment on ${isPR ? 'PR' : 'Issue'} #${issue?.number}`,
            description: `**${issue?.title}**\n\n${truncate(comment?.body, 500)}`,
            url: comment?.html_url,
            color: COLORS.blue,
        };
    },

    create: payload => {
        const refType = payload.ref_type;
        const ref = payload.ref;
        const emoji = refType === 'tag' ? '🏷️' : '🌿';
        return {
            ...getBaseEmbed(payload),
            title: `${emoji} ${refType?.charAt(0).toUpperCase() + refType?.slice(1)} Created`,
            description: `${refType === 'tag' ? 'Tag' : 'Branch'} \`${ref}\` was created`,
            url: payload.repository?.html_url,
            color: COLORS.green,
        };
    },

    delete: payload => {
        const refType = payload.ref_type;
        const ref = payload.ref;
        const emoji = refType === 'tag' ? '🏷️' : '🌿';
        return {
            ...getBaseEmbed(payload),
            title: `${emoji} ${refType?.charAt(0).toUpperCase() + refType?.slice(1)} Deleted`,
            description: `${refType === 'tag' ? 'Tag' : 'Branch'} \`${ref}\` was deleted`,
            url: payload.repository?.html_url,
            color: COLORS.red,
        };
    },

    release: payload => {
        const release = payload.release;
        const action = payload.action;
        const actionEmojis: Record<string, string> = {
            published: '🚀',
            created: '✨',
            edited: '✏️',
            deleted: '🗑️',
            prereleased: '🧪',
            released: '🚀',
        };

        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '📦'} Release ${action}: ${release?.tag_name}`,
            description: `**${release?.name || release?.tag_name}**\n\n${truncate(release?.body, 1000)}`,
            url: release?.html_url,
            color: action === 'published' || action === 'released' ? COLORS.green : COLORS.blue,
            fields: [
                { name: 'Tag', value: release?.tag_name || 'N/A', inline: true },
                { name: 'Prerelease', value: release?.prerelease ? 'Yes' : 'No', inline: true },
                { name: 'Draft', value: release?.draft ? 'Yes' : 'No', inline: true },
            ],
        };
    },

    fork: payload => ({
        ...getBaseEmbed(payload),
        title: '🍴 Repository Forked',
        description: `**${payload.sender?.login}** forked the repository to **${payload.forkee?.full_name}**`,
        url: payload.forkee?.html_url,
        color: COLORS.cyan,
    }),

    star: payload => {
        const isStarred = payload.action === 'created';
        return {
            ...getBaseEmbed(payload),
            title: isStarred ? '⭐ Repository Starred' : '💔 Star Removed',
            description: `**${payload.sender?.login}** ${isStarred ? 'starred' : 'unstarred'} the repository`,
            url: payload.repository?.html_url,
            color: isStarred ? COLORS.yellow : COLORS.gray,
        };
    },

    watch: payload => ({
        ...getBaseEmbed(payload),
        title: '👁️ Repository Watched',
        description: `**${payload.sender?.login}** started watching the repository`,
        url: payload.repository?.html_url,
        color: COLORS.cyan,
    }),

    commit_comment: payload => ({
        ...getBaseEmbed(payload),
        title: '💬 Commit Comment',
        description: `Comment on commit \`${payload.comment?.commit_id?.substring(0, 7)}\`\n\n${truncate(payload.comment?.body, 500)}`,
        url: payload.comment?.html_url,
        color: COLORS.blue,
    }),

    gollum: payload => {
        const pages = payload.pages || [];
        const pageList = pages
            .slice(0, 5)
            .map(
                (p: { action: string; title: string; html_url: string }) =>
                    `• **${p.action}**: [${p.title}](${p.html_url})`,
            )
            .join('\n');
        return {
            ...getBaseEmbed(payload),
            title: '📚 Wiki Updated',
            description: `${pages.length} page(s) modified:\n\n${pageList}`,
            url: payload.repository?.html_url + '/wiki',
            color: COLORS.blue,
        };
    },

    member: payload => {
        const member = payload.member;
        const action = payload.action;
        const actionEmojis: Record<string, string> = { added: '➕', removed: '➖', edited: '✏️' };
        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '👥'} Collaborator ${action}`,
            description: `**${member?.login}** was ${action} as a collaborator`,
            url: member?.html_url,
            color: action === 'added' ? COLORS.green : action === 'removed' ? COLORS.red : COLORS.blue,
            thumbnail: { url: member?.avatar_url },
        };
    },

    public: payload => ({
        ...getBaseEmbed(payload),
        title: '🌍 Repository Made Public',
        description: `**${payload.repository?.full_name}** is now public!`,
        url: payload.repository?.html_url,
        color: COLORS.green,
    }),

    repository: payload => {
        const action = payload.action;
        const repo = payload.repository;
        const actionEmojis: Record<string, string> = {
            created: '✨',
            deleted: '🗑️',
            archived: '📦',
            unarchived: '📂',
            edited: '✏️',
            renamed: '📝',
            transferred: '➡️',
            publicized: '🌍',
            privatized: '🔒',
        };
        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '📁'} Repository ${action}`,
            description: `**${repo?.full_name}**\n\n${truncate(repo?.description, 500)}`,
            url: repo?.html_url,
            color: action === 'deleted' ? COLORS.red : COLORS.green,
        };
    },

    workflow_run: payload => {
        const workflow = payload.workflow_run || payload.workflow;
        const action = payload.action;
        const conclusion = workflow?.conclusion;

        const conclusionEmojis: Record<string, string> = {
            success: '✅',
            failure: '❌',
            cancelled: '⏹️',
            skipped: '⏭️',
            timed_out: '⏰',
            action_required: '⚠️',
        };
        const conclusionColors: Record<string, number> = {
            success: COLORS.green,
            failure: COLORS.red,
            cancelled: COLORS.gray,
            skipped: COLORS.gray,
        };

        return {
            ...getBaseEmbed(payload),
            title: `${conclusion ? conclusionEmojis[conclusion] || '⚙️' : '⚙️'} Workflow ${action}: ${workflow?.name}`,
            description: `Workflow **${workflow?.name}** ${action}\n\nBranch: \`${workflow?.head_branch}\`\nConclusion: ${conclusion || 'in progress'}`,
            url: workflow?.html_url,
            color: conclusion ? conclusionColors[conclusion] || COLORS.blue : COLORS.yellow,
            fields: [
                { name: 'Event', value: workflow?.event || 'N/A', inline: true },
                { name: 'Status', value: workflow?.status || 'N/A', inline: true },
                { name: 'Run #', value: String(workflow?.run_number || 'N/A'), inline: true },
            ],
        };
    },

    workflow_job: payload => {
        const job = payload.workflow_job;
        const action = payload.action;
        const conclusion = job?.conclusion;
        const conclusionEmojis: Record<string, string> = {
            success: '✅',
            failure: '❌',
            cancelled: '⏹️',
            skipped: '⏭️',
        };
        return {
            ...getBaseEmbed(payload),
            title: `${conclusion ? conclusionEmojis[conclusion] || '⚙️' : '🔄'} Job ${action}: ${job?.name}`,
            description: `Job **${job?.name}** ${action}`,
            url: job?.html_url,
            color: conclusion === 'success' ? COLORS.green : conclusion === 'failure' ? COLORS.red : COLORS.yellow,
        };
    },

    check_run: payload => {
        const checkRun = payload.check_run;
        const action = payload.action;
        const conclusion = checkRun?.conclusion;
        const conclusionEmojis: Record<string, string> = {
            success: '✅',
            failure: '❌',
            neutral: '➖',
            cancelled: '⏹️',
            skipped: '⏭️',
            timed_out: '⏰',
            action_required: '⚠️',
        };
        return {
            ...getBaseEmbed(payload),
            title: `${conclusion ? conclusionEmojis[conclusion] || '🔍' : '🔍'} Check Run ${action}: ${checkRun?.name}`,
            description: `Check **${checkRun?.name}** ${action}\n\nStatus: ${checkRun?.status}\nConclusion: ${conclusion || 'pending'}`,
            url: checkRun?.html_url,
            color: conclusion === 'success' ? COLORS.green : conclusion === 'failure' ? COLORS.red : COLORS.yellow,
        };
    },

    check_suite: payload => {
        const suite = payload.check_suite;
        const action = payload.action;
        const conclusion = suite?.conclusion;
        return {
            ...getBaseEmbed(payload),
            title: `${conclusion === 'success' ? '✅' : conclusion === 'failure' ? '❌' : '🔄'} Check Suite ${action}`,
            description: `Check suite for \`${suite?.head_branch}\`\n\nStatus: ${suite?.status}\nConclusion: ${conclusion || 'pending'}`,
            url: suite?.url,
            color: conclusion === 'success' ? COLORS.green : conclusion === 'failure' ? COLORS.red : COLORS.yellow,
        };
    },

    deployment: payload => ({
        ...getBaseEmbed(payload),
        title: '🚀 Deployment Created',
        description: `Deployment to **${payload.deployment?.environment}**\n\nRef: \`${payload.deployment?.ref}\``,
        url: payload.deployment?.url,
        color: COLORS.blue,
    }),

    deployment_status: payload => {
        const status = payload.deployment_status;
        const deployment = payload.deployment;
        const stateEmojis: Record<string, string> = {
            pending: '⏳',
            success: '✅',
            failure: '❌',
            error: '❌',
            inactive: '💤',
            in_progress: '🔄',
            queued: '📋',
        };
        const stateColors: Record<string, number> = {
            success: COLORS.green,
            failure: COLORS.red,
            error: COLORS.red,
            pending: COLORS.yellow,
            in_progress: COLORS.yellow,
        };
        const state = status?.state || 'unknown';
        return {
            ...getBaseEmbed(payload),
            title: `${stateEmojis[state] || '📦'} Deployment ${state}`,
            description: `Deployment to **${deployment?.environment}** is ${state}\n\n${truncate(status?.description, 200)}`,
            url: status?.target_url || deployment?.url,
            color: stateColors[state] || COLORS.gray,
        };
    },

    status: payload => {
        const state = payload.state;
        const stateEmojis: Record<string, string> = { pending: '⏳', success: '✅', failure: '❌', error: '❌' };
        const stateColors: Record<string, number> = {
            success: COLORS.green,
            failure: COLORS.red,
            error: COLORS.red,
            pending: COLORS.yellow,
        };
        return {
            ...getBaseEmbed(payload),
            title: `${stateEmojis[state] || '📊'} Commit Status: ${state}`,
            description: `${payload.description || 'Status update'}\n\nCommit: \`${payload.sha?.substring(0, 7)}\`\nContext: ${payload.context}`,
            url: payload.target_url,
            color: stateColors[state] || COLORS.gray,
        };
    },

    discussion: payload => {
        const discussion = payload.discussion;
        const action = payload.action;
        const actionEmojis: Record<string, string> = {
            created: '💬',
            edited: '✏️',
            deleted: '🗑️',
            pinned: '📌',
            unpinned: '📌',
            locked: '🔒',
            unlocked: '🔓',
            transferred: '➡️',
            answered: '✅',
            unanswered: '❓',
        };
        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '💬'} Discussion ${action}: #${discussion?.number}`,
            description: `**${discussion?.title}**\n\n${truncate(discussion?.body, 500)}`,
            url: discussion?.html_url,
            color: action === 'answered' ? COLORS.green : COLORS.blue,
            fields: [{ name: 'Category', value: discussion?.category?.name || 'General', inline: true }],
        };
    },

    discussion_comment: payload => ({
        ...getBaseEmbed(payload),
        title: `💬 Comment on Discussion #${payload.discussion?.number}`,
        description: `**${payload.discussion?.title}**\n\n${truncate(payload.comment?.body, 500)}`,
        url: payload.comment?.html_url,
        color: COLORS.blue,
    }),

    label: payload => {
        const label = payload.label;
        const action = payload.action;
        const labelColor = parseInt(label?.color || '95a5a6', 16);
        return {
            ...getBaseEmbed(payload),
            title: `🏷️ Label ${action}`,
            description: `Label **${label?.name}** was ${action}\n\n${label?.description || ''}`,
            url: payload.repository?.html_url + '/labels',
            color: labelColor,
        };
    },

    milestone: payload => {
        const milestone = payload.milestone;
        const action = payload.action;
        const actionEmojis: Record<string, string> = {
            created: '✨',
            closed: '✅',
            opened: '📂',
            edited: '✏️',
            deleted: '🗑️',
        };
        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '🎯'} Milestone ${action}`,
            description: `**${milestone?.title}**\n\n${truncate(milestone?.description, 500)}`,
            url: milestone?.html_url,
            color: action === 'closed' ? COLORS.green : COLORS.blue,
            fields: [
                { name: 'Open Issues', value: String(milestone?.open_issues || 0), inline: true },
                { name: 'Closed Issues', value: String(milestone?.closed_issues || 0), inline: true },
                { name: 'Due Date', value: milestone?.due_on?.split('T')[0] || 'No due date', inline: true },
            ],
        };
    },

    projects_v2: payload => ({
        ...getBaseEmbed(payload),
        title: `📊 Project ${payload.action}`,
        description: `Project **${payload.projects_v2?.title}** was ${payload.action}`,
        url: payload.projects_v2?.html_url,
        color: COLORS.blue,
    }),

    projects_v2_item: payload => ({
        ...getBaseEmbed(payload),
        title: `📊 Project Item ${payload.action}`,
        description: `A project item was ${payload.action}`,
        url: payload.repository?.html_url,
        color: COLORS.blue,
    }),

    package: payload => ({
        ...getBaseEmbed(payload),
        title: `📦 Package ${payload.action}`,
        description: `Package **${payload.package?.name}** (${payload.package?.package_type}) was ${payload.action}`,
        url: payload.package?.html_url,
        color: payload.action === 'published' ? COLORS.green : COLORS.blue,
    }),

    registry_package: payload => ({
        ...getBaseEmbed(payload),
        title: `📦 Registry Package ${payload.action}`,
        description: `Package **${payload.registry_package?.name}** was ${payload.action}`,
        url: payload.registry_package?.html_url,
        color: COLORS.blue,
    }),

    security_advisory: payload => ({
        ...getBaseEmbed(payload),
        title: `🔒 Security Advisory ${payload.action}`,
        description: `**${payload.security_advisory?.summary}**\n\nSeverity: ${payload.security_advisory?.severity}`,
        url: payload.security_advisory?.html_url,
        color: COLORS.pink,
    }),

    code_scanning_alert: payload => {
        const alert = payload.alert;
        const severityColors: Record<string, number> = {
            critical: COLORS.red,
            high: COLORS.red,
            medium: COLORS.orange,
            low: COLORS.yellow,
        };
        return {
            ...getBaseEmbed(payload),
            title: `🔍 Code Scanning Alert ${payload.action}`,
            description: `**${alert?.rule?.description || 'Security Alert'}**\n\nSeverity: ${alert?.rule?.severity || 'unknown'}`,
            url: alert?.html_url,
            color: severityColors[alert?.rule?.severity] || COLORS.pink,
        };
    },

    secret_scanning_alert: payload => ({
        ...getBaseEmbed(payload),
        title: `🔐 Secret Scanning Alert ${payload.action}`,
        description: `Secret type: **${payload.alert?.secret_type_display_name || payload.alert?.secret_type}**\n\nState: ${payload.alert?.state}`,
        url: payload.alert?.html_url,
        color: COLORS.pink,
    }),

    dependabot_alert: payload => {
        const alert = payload.alert;
        const severityColors: Record<string, number> = {
            critical: COLORS.red,
            high: COLORS.red,
            medium: COLORS.orange,
            low: COLORS.yellow,
        };
        return {
            ...getBaseEmbed(payload),
            title: `🤖 Dependabot Alert ${payload.action}`,
            description: `**${alert?.security_advisory?.summary || 'Dependency Alert'}**\n\nPackage: ${alert?.dependency?.package?.name}\nSeverity: ${alert?.security_advisory?.severity}`,
            url: alert?.html_url,
            color: severityColors[alert?.security_advisory?.severity] || COLORS.orange,
        };
    },

    sponsorship: payload => {
        const sponsorship = payload.sponsorship;
        const action = payload.action;
        const actionEmojis: Record<string, string> = {
            created: '❤️',
            cancelled: '💔',
            edited: '✏️',
            tier_changed: '📈',
            pending_cancellation: '⚠️',
            pending_tier_change: '⏳',
        };
        return {
            ...getBaseEmbed(payload),
            title: `${actionEmojis[action] || '💝'} Sponsorship ${action}`,
            description: `**${sponsorship?.sponsor?.login}** ${action} sponsorship`,
            url: `https://github.com/sponsors/${sponsorship?.sponsorable?.login}`,
            color: action === 'created' ? COLORS.pink : COLORS.gray,
            thumbnail: { url: sponsorship?.sponsor?.avatar_url },
        };
    },

    team: payload => ({
        ...getBaseEmbed(payload),
        title: `👥 Team ${payload.action}`,
        description: `Team **${payload.team?.name}** was ${payload.action}\n\n${truncate(payload.team?.description, 200)}`,
        url: payload.team?.html_url,
        color: COLORS.blue,
    }),

    team_add: payload => ({
        ...getBaseEmbed(payload),
        title: '👥 Team Added to Repository',
        description: `Team **${payload.team?.name}** was added to **${payload.repository?.full_name}**`,
        url: payload.repository?.html_url,
        color: COLORS.green,
    }),

    organization: payload => ({
        ...getBaseEmbed(payload),
        title: `🏢 Organization ${payload.action}`,
        description: `Organization **${payload.organization?.login}** event: ${payload.action}`,
        url: `https://github.com/${payload.organization?.login}`,
        color: COLORS.blue,
    }),

    membership: payload => ({
        ...getBaseEmbed(payload),
        title: `👤 Team Membership ${payload.action}`,
        description: `**${payload.member?.login}** was ${payload.action} ${payload.action === 'added' ? 'to' : 'from'} team **${payload.team?.name}**`,
        url: payload.team?.html_url,
        color: payload.action === 'added' ? COLORS.green : COLORS.red,
    }),

    meta: payload => ({
        ...getBaseEmbed(payload),
        title: `🔧 Webhook ${payload.action}`,
        description: `Webhook was ${payload.action}`,
        url: payload.hook?.config?.url,
        color: payload.action === 'deleted' ? COLORS.red : COLORS.blue,
    }),

    page_build: payload => {
        const build = payload.build;
        const status = build?.status;
        const statusEmojis: Record<string, string> = { built: '✅', building: '🔄', errored: '❌' };
        return {
            ...getBaseEmbed(payload),
            title: `${statusEmojis[status] || '📄'} GitHub Pages Build`,
            description: `Pages build ${status}\n\nCommit: \`${build?.commit?.substring(0, 7)}\``,
            url: payload.repository?.html_url,
            color: status === 'built' ? COLORS.green : status === 'errored' ? COLORS.red : COLORS.yellow,
        };
    },

    deploy_key: payload => ({
        ...getBaseEmbed(payload),
        title: `🔑 Deploy Key ${payload.action}`,
        description: `Deploy key **${payload.key?.title}** was ${payload.action}`,
        url: payload.repository?.html_url + '/settings/keys',
        color: payload.action === 'created' ? COLORS.green : COLORS.red,
    }),

    branch_protection_rule: payload => ({
        ...getBaseEmbed(payload),
        title: `🛡️ Branch Protection ${payload.action}`,
        description: `Protection rule for pattern \`${payload.rule?.pattern}\` was ${payload.action}`,
        url: payload.repository?.html_url + '/settings/branches',
        color: COLORS.blue,
    }),
};

function transformGitHubToDiscord(payload: GitHubPayload, eventType: string): DiscordWebhookPayload {
    const handler = eventHandlers[eventType];

    if (handler) {
        try {
            const embed = handler(payload);
            return createDiscordPayload(embed);
        } catch (error) {
            console.error(`Error processing ${eventType}:`, error);
        }
    }

    return createDiscordPayload({
        ...getBaseEmbed(payload),
        title: `📢 GitHub Event: ${eventType}`,
        description: `Action: ${payload.action || 'N/A'}\nRepository: **${payload.repository?.full_name || 'Unknown'}**`,
        url: payload.repository?.html_url,
        color: COLORS.gray,
    });
}

async function sendToDiscord(payload: DiscordWebhookPayload): Promise<Response> {
    if (!DISCORD_WEBHOOK_URL) {
        throw new Error('DISCORD_WEBHOOK_URL no está configurada');
    }

    return await fetch(DISCORD_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
}

async function handleWebhook(req: Request): Promise<Response> {
    if (req.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
    }

    try {
        const githubEvent = req.headers.get('X-GitHub-Event') || 'unknown';
        const payload: GitHubPayload = await req.json();

        console.log(`📥 Received GitHub event: ${githubEvent} (action: ${payload.action || 'N/A'})`);

        const discordPayload = transformGitHubToDiscord(payload, githubEvent);
        const discordResponse = await sendToDiscord(discordPayload);

        if (!discordResponse.ok) {
            const errorText = await discordResponse.text();
            console.error(`❌ Discord error: ${errorText}`);
            return new Response(`Discord error: ${errorText}`, { status: 500 });
        }

        console.log(`✅ Successfully forwarded ${githubEvent} to Discord`);
        return new Response('OK', { status: 200 });
    } catch (error) {
        console.error(`❌ Error processing webhook:`, error);
        return new Response(`Error: ${error}`, { status: 500 });
    }
}

function handler(req: Request): Promise<Response> | Response {
    const url = new URL(req.url);

    if (url.pathname === '/webhook') {
        return handleWebhook(req);
    }

    if (url.pathname === '/' && req.method === 'GET') {
        const supportedEvents = Object.keys(eventHandlers).join(', ');
        return new Response(
            `GitHub to Discord Proxy is running! 🚀\n\nSupported events: ${supportedEvents}\n\nTotal: ${Object.keys(eventHandlers).length} event types`,
            { status: 200, headers: { 'Content-Type': 'text/plain' } },
        );
    }

    return new Response('Not found', { status: 404 });
}

console.log(`🚀 Server running on http://localhost:${PORT}`);
console.log(`📌 Webhook endpoint: http://localhost:${PORT}/webhook`);
console.log(`📋 Supported events: ${Object.keys(eventHandlers).length}`);

if (!DISCORD_WEBHOOK_URL) {
    console.warn('⚠️  DISCORD_WEBHOOK_URL is not set!');
}

Deno.serve({ port: PORT }, handler);
