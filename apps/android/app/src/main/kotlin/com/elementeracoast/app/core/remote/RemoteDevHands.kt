package com.elementeracoast.app.core.remote

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

@Serializable
data class RemoteGithubRepoCheck(
    val repo: String = "",
    val readable: Boolean = false,
    @SerialName("default_branch") val defaultBranch: String? = null,
    val private: Boolean? = null,
    @SerialName("error_type") val errorType: String? = null
)

@Serializable
data class RemoteGithubSelfCheck(
    @SerialName("github_token_present") val githubTokenPresent: Boolean = false,
    @SerialName("allowed_repos") val allowedRepos: List<String> = emptyList(),
    @SerialName("github_read_enabled") val githubReadEnabled: Boolean = true,
    @SerialName("repo_metadata_readable") val repoMetadataReadable: Boolean? = null,
    @SerialName("can_read_default_branch") val canReadDefaultBranch: Boolean? = null,
    @SerialName("can_read_actions") val canReadActions: Boolean? = null,
    val repos: List<RemoteGithubRepoCheck> = emptyList()
)

@Serializable
data class RemoteNotionSelfCheck(
    @SerialName("notion_token_present") val notionTokenPresent: Boolean = false,
    @SerialName("root_page_id_present") val rootPageIdPresent: Boolean = false,
    @SerialName("notion_read_enabled") val notionReadEnabled: Boolean = true,
    @SerialName("root_page_readable") val rootPageReadable: Boolean? = null,
    @SerialName("root_page_title") val rootPageTitle: String? = null,
    @SerialName("can_append_test_block") val canAppendTestBlock: Boolean? = null,
    @SerialName("error_type") val errorType: String? = null
)

@Serializable
data class RemoteDeveloperTool(
    val name: String = "",
    val pack: String? = null,
    @SerialName("target_system") val targetSystem: String? = null,
    val risk: String? = null
)

@Serializable
data class RemoteDevSelfCheckResponse(
    val ok: Boolean = true,
    val release: String? = null,
    @SerialName("model_tools_default") val modelToolsDefault: Boolean = false,
    @SerialName("construction_mode_required") val constructionModeRequired: Boolean = false,
    @SerialName("tool_switches_required") val toolSwitchesRequired: Boolean = false,
    @SerialName("confirmation_required") val confirmationRequired: Boolean = false,
    @SerialName("developer_tools") val developerTools: List<RemoteDeveloperTool> = emptyList(),
    val github: RemoteGithubSelfCheck = RemoteGithubSelfCheck(),
    val notion: RemoteNotionSelfCheck = RemoteNotionSelfCheck(),
    @SerialName("run_ids") val runIds: List<String> = emptyList()
)

@Serializable
data class RemoteNativeUpdate(
    @SerialName("version_code") val versionCode: Int? = null,
    @SerialName("version_name") val versionName: String? = null,
    @SerialName("application_id") val applicationId: String? = null,
    @SerialName("stable_signing") val stableSigning: Boolean? = null,
    @SerialName("apk_sha256") val apkSha256: String? = null,
    @SerialName("apk_filename") val apkFilename: String? = null,
    @SerialName("overwrite_installable") val overwriteInstallable: Boolean? = null,
    @SerialName("update_time") val updateTime: String? = null,
    @SerialName("update_notes") val updateNotes: String? = null,
    @SerialName("known_risk") val knownRisk: String? = null,
    val reason: String? = null
)

@Serializable
data class RemoteDevUpdate(
    @SerialName("pwa_cache_version") val pwaCacheVersion: String? = null,
    val native: RemoteNativeUpdate? = null,
    val available: Boolean = false,
    val reason: String? = null,
    val release: String? = null
)

@Serializable
data class RemoteDevUpdateResponse(
    val ok: Boolean = true,
    val update: RemoteDevUpdate = RemoteDevUpdate(),
    @SerialName("run_id") val runId: String? = null
)

@Serializable
data class RemoteDevRun(
    val id: String = "",
    @SerialName("target_system") val targetSystem: String = "",
    @SerialName("action_name") val actionName: String = "",
    @SerialName("target_ref") val targetRef: String? = null,
    @SerialName("operation_type") val operationType: String = "read",
    val status: String = "",
    @SerialName("output_summary") val outputSummary: JsonElement? = null,
    @SerialName("error_summary") val errorSummary: String? = null,
    @SerialName("created_at") val createdAt: String? = null,
    @SerialName("finished_at") val finishedAt: String? = null
)

@Serializable
data class RemoteDevRunsResponse(
    val ok: Boolean = true,
    val runs: List<RemoteDevRun> = emptyList()
)
