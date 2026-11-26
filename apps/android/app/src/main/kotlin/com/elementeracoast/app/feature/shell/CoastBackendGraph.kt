package com.elementeracoast.app.feature.shell

import android.content.Context
import com.elementeracoast.app.core.auth.AndroidKeystoreAuthStore
import com.elementeracoast.app.core.auth.AuthRepository
import com.elementeracoast.app.core.auth.AuthStore
import com.elementeracoast.app.core.auth.MemoryAuthStore
import com.elementeracoast.app.core.auth.DefaultAuthRepository
import com.elementeracoast.app.core.local.LocalPersistence
import com.elementeracoast.app.core.local.LocalProviderStore
import com.elementeracoast.app.core.local.LocalKnowledgeStore
import com.elementeracoast.app.core.local.LocalSoilOrganizer
import com.elementeracoast.app.core.local.LocalDailyComment
import com.elementeracoast.app.feature.chat.LocalDirectChatRepository
import com.elementeracoast.app.core.network.CoastApiClient
import com.elementeracoast.app.core.network.CoastApiConfig
import com.elementeracoast.app.core.network.CoastHttpClient
import com.elementeracoast.app.core.remote.RemoteCacheStore
import com.elementeracoast.app.feature.chat.ChatRepository
import com.elementeracoast.app.feature.chat.AndroidRealityContextSource
import com.elementeracoast.app.feature.chat.RealityContextSource
import com.elementeracoast.app.feature.chat.DefaultChatRepository
import com.elementeracoast.app.feature.chat.ReasoningEffortStore
import com.elementeracoast.app.feature.chat.NativeChatGptTurnRepository
import com.elementeracoast.app.feature.chatgpt.ChatGptPlanRepository
import com.elementeracoast.app.feature.chat.ModelMetadataRemoteDataSource
import com.elementeracoast.app.feature.daily.DailyRepository
import com.elementeracoast.app.feature.daily.DefaultDailyRepository
import com.elementeracoast.app.feature.dogtalk.CrossWindowRepository
import com.elementeracoast.app.feature.dogtalk.DefaultCrossWindowRepository
import com.elementeracoast.app.feature.dogtalk.DefaultDogtalkRepository
import com.elementeracoast.app.feature.dogtalk.DogtalkRepository
import com.elementeracoast.app.feature.memory.DefaultMemoryRepository
import com.elementeracoast.app.feature.memory.DefaultThoughtSoilRepository
import com.elementeracoast.app.feature.memory.MemoryRemoteDataSource
import com.elementeracoast.app.feature.memory.MemoryRepository
import com.elementeracoast.app.feature.memory.ThoughtSoilRepository
import com.elementeracoast.app.feature.wolf.DefaultGlobalArchiveRepository
import com.elementeracoast.app.feature.wolf.GlobalArchiveRepository

data class CoastBackendGraph(
    val auth: AuthRepository,
    val conversations: ConversationRepository,
    val profile: ProfileRepository,
    val chat: ChatRepository,
    val reality: RealityContextSource,
    val thoughtSoil: ThoughtSoilRepository,
    val daily: DailyRepository,
    val memory: MemoryRepository,
    val dogtalk: DogtalkRepository,
    val crossWindow: CrossWindowRepository,
    val archive: GlobalArchiveRepository,
    val officialChat: ChatRepository? = null
) {
    companion object {
        fun production(
            context: Context, persistence: LocalPersistence,
            chatGptPlan: ChatGptPlanRepository? = null
        ): CoastBackendGraph {
            val config = CoastApiConfig.production()
            val authStore: AuthStore = if (config.localTransport != null) MemoryAuthStore() else AndroidKeystoreAuthStore(context.applicationContext)
            val http = CoastHttpClient(config, authStore).client
            val api = CoastApiClient(config, http)
            val cache = RemoteCacheStore(persistence)
            val memoryRemote = MemoryRemoteDataSource(config, http)
            val metadataRemote = ModelMetadataRemoteDataSource(config, http)
            val titleRemote = ConversationTitleRemoteDataSource(config, http)
            val reasoning = ReasoningEffortStore.production(context)
            val toolLimit = { com.elementeracoast.app.core.network.TurnToolPolicy.stored(persistence) }
            val chatRepository = DefaultChatRepository(api, cache, metadataRemote, reasoningStore = reasoning,toolLimit=toolLimit)
            return CoastBackendGraph(
                auth = DefaultAuthRepository(authStore, api),
                conversations = DefaultConversationRepository(api, cache, titleRemote),
                profile = DefaultProfileRepository(api, cache),
                chat = if (config.localTransport != null) LocalDirectChatRepository(chatRepository, LocalProviderStore(context), LocalKnowledgeStore(persistence,com.elementeracoast.app.core.local.LocalIndependentWeb(context.applicationContext),com.elementeracoast.app.core.local.LocalVoiceProvider(context.applicationContext))) else chatRepository,
                reality = AndroidRealityContextSource(context.applicationContext, persistence,config.localTransport!=null),
                thoughtSoil = DefaultThoughtSoilRepository(api, chatGptPlan,
                    if (config.localTransport != null) LocalSoilOrganizer(persistence, LocalProviderStore(context), chatGptPlan)::organize else null),
                daily = DefaultDailyRepository(api, cache,
                    if (config.localTransport != null) LocalDailyComment(persistence, LocalProviderStore(context), chatGptPlan)::request else null),
                memory = DefaultMemoryRepository(memoryRemote, cache),
                dogtalk = DefaultDogtalkRepository(config, http),
                crossWindow = DefaultCrossWindowRepository(config, http),
                archive = DefaultGlobalArchiveRepository(api),
                officialChat = chatGptPlan?.let { NativeChatGptTurnRepository(api, chatRepository, it, reasoning,toolLimit=toolLimit) }
            )
        }
    }
}
