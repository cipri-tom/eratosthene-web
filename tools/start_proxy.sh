#!/bin/bash

WEB_PORT='11036'   # unstable -- 11027
LOCAL_IP='127.0.0.1'

# external addr
websockify "$LOCAL_IP:$WEB_PORT" 149.202.222.194:"$WEB_PORT"
