plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("com.google.gms.google-services")
}

android {
    namespace = "id.smartrt.resident"
    compileSdk = 35

    defaultConfig {
        applicationId = "id.smartrt.resident"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables.useSupportLibrary = true
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
            manifestPlaceholders["appLinksHost"] = "smart-rt-nine.vercel.app"
            buildConfigField("String", "WEB_BASE_URL", "\"https://smart-rt-nine.vercel.app\"")
            buildConfigField("String", "ALLOWED_HOST", "\"smart-rt-nine.vercel.app\"")
            buildConfigField("String", "ALLOWED_ORIGIN", "\"https://smart-rt-nine.vercel.app\"")
        }
        create("staging") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".staging"
            matchingFallbacks += listOf("debug")
            manifestPlaceholders["appLinksHost"] = "smart-rt-nine.vercel.app"
            buildConfigField("String", "WEB_BASE_URL", "\"https://smart-rt-nine.vercel.app\"")
            buildConfigField("String", "ALLOWED_HOST", "\"smart-rt-nine.vercel.app\"")
            buildConfigField("String", "ALLOWED_ORIGIN", "\"https://smart-rt-nine.vercel.app\"")
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            manifestPlaceholders["appLinksHost"] = "resident.smartrt.id"
            buildConfigField("String", "WEB_BASE_URL", "\"https://resident.smartrt.id\"")
            buildConfigField("String", "ALLOWED_HOST", "\"resident.smartrt.id\"")
            buildConfigField("String", "ALLOWED_ORIGIN", "\"https://resident.smartrt.id\"")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    testOptions {
        unitTests {
            isIncludeAndroidResources = true
            isReturnDefaultValues = true
        }
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.activity:activity-ktx:1.8.1")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")

    // Coroutines — required for DocumentActionController background download
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Firebase Cloud Messaging (BOM-managed)
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging-ktx")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20231013")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
}

