#include <jni.h>

#include <cstdlib>
#include <cstring>
namespace node {
int Start(int argc, char* argv[]);
}
extern "C" JNIEXPORT jint JNICALL
Java_com_jtmedia_crapstv_HostService_startNode(JNIEnv* env, jclass,
                                               jstring script, jstring root) {
  const char* s = env->GetStringUTFChars(script, nullptr);
  const char* r = env->GetStringUTFChars(root, nullptr);
  size_t len = 5 + strlen(s) + 1 + strlen(r) + 1;
  char* buf = (char*)calloc(len, 1);
  char* args[3];
  args[0] = buf;
  strcpy(buf, "node");
  args[1] = buf + 5;
  strcpy(args[1], s);
  args[2] = args[1] + strlen(s) + 1;
  strcpy(args[2], r);
  env->ReleaseStringUTFChars(script, s);
  env->ReleaseStringUTFChars(root, r);
  int result = node::Start(3, args);
  free(buf);
  return result;
}
